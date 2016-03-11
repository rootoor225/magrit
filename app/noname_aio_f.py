# -*- coding: utf-8 -*-
"""
Basicly trying to do here the same things as in the "noname.py" file but
using aiohttp framework instead of Flask
(same urls, same jinja2 templating system,
same services provided and roughly the same variable/function/etc. names)

@author: mz
"""
import os
import sys
import ujson as json
import time
import pandas as pd
import fiona
import threading

from zipfile import ZipFile
from random import randint, choice
from datetime import datetime
from base64 import b64decode
import asyncio
import zmq.asyncio
from subprocess import Popen, PIPE

# Web related stuff :
import jinja2
import aiohttp_jinja2
from aiohttp import web, web_reqrep
#import aiohttp_debugtoolbar
from aiohttp_session import get_session, session_middleware
from aiohttp_session.cookie_storage import EncryptedCookieStorage

# Just for the R console page based on rpy2 :
from r_py.rpy2_console_client import client_Rpy_async
from r_py.rpy2_console_queue import launch_queue

# For the other actions involving R :
from r_py.rclient import rClient_async
from r_py.rclient_load_balance_async import (
    launch_async_broker, R_client_fuw_async, url_client, prepare_worker)

# Used for the page generation with jinja2 and wtforms:
from helpers.misc import guess_separator
from helpers.forms import (
    MTA_form_global, MTA_form_medium, MTA_form_local, SpatialPos_Form,
    RstatementForm, FlowsForm)

# For testing purpose only, in order to make the topojson translation staying
# in a python environnement :
from pytopojson import topo_to_geo

pp = '(aiohttp_app) '

class g2:
    """
    Global holder object for various informations
    Aimed to be remplaced by something better
    """
    UPLOAD_FOLDER = 'tmp/users_uploads'
    app_real_path = '/home/mz/code/noname-stuff'
    keys_mapping = {}
    session_map = {}
    table_map = {}


def find_port():
    while True:
        port = randint(10000, 20000)
        if port not in g2.keys_mapping.values():
            return port


def get_key(var=g2.keys_mapping):
    """Find and return an available key (ie. which is not in 'var')"""
    while True:
        k = ''.join([bytes([randint(65, 122)]).decode() for _ in range(25)])
        if k not in var:
            return k


def get_name(length=25):
    """
    Find a temporary random name to share object
    with some external soft used ( R / ogr2ogr / topojson / etc.)
    Aimed to be remplaced by something better
    """
    return ''.join([bytes([choice(list(range(48, 57))
                                  + list(range(65, 90))
                                  + list(range(97, 122)))]).decode()
                    for i in range(length)])


@aiohttp_jinja2.template('index.html')
@asyncio.coroutine
def handler(request):
    return {}


@aiohttp_jinja2.template('index2.html')
@asyncio.coroutine
def handler2(request):
    session = yield from get_session(request)
    try:
        date = 'Last visit : {}'.format(
            datetime.fromtimestamp(
                session['last_visit']).strftime("%B %d, %Y at %H:%M:%S"))
    except Exception as err:
        date = str(err)
    session['last_visit'] = time.time()
    return {'date': date}


@asyncio.coroutine
def is_known_user(request, ref=g2.session_map):
    session = yield from get_session(request)
    if 'R_user' in session and session['R_user'] in ref:
        id_ = session['R_user']
        assert id_ in ref
        print(session['R_user'], ' is a kwown user')
    else:
        id_ = get_key(var=ref)
        session['R_user'] = id_
        ref[id_] = [True, None]
        print(session['R_user'], ' is a new user')
    return id_


#####################################################
### Some views to make two poor R consoles
### (one using a remote R instance, the other using rpy2)
### Each user has its own session (based on session id on cookies)
### The rpy2 version is currently the only able to display the plot
### eventually requested.
#####################################################

class Rpy2_console(web.View):
    """
    Using a client written with zmq.asyncio package (but a broker using regular
    pyzmq implementation)
    """
    @aiohttp_jinja2.template('R_form_console.html')
    @asyncio.coroutine
    def get(self):
        R_form = RstatementForm()
        content = ''  # Todo : write the last content in the cookies to redisplay it ?
        return {'form': R_form, 'content': content}

    @asyncio.coroutine
    def post(self):
        posted_data = yield from self.request.post()
        sess = yield from get_session(self.request)
        rcommande = posted_data['rcommande']
        if 'rpy2_session' in sess and sess['rpy2_session'] in g2.keys_mapping:
            port, pid = g2.keys_mapping[sess['rpy2_session']]
            cRpy = client_Rpy_async("ipc:///tmp/feeds/rpy2_clients", port,
                                    ctx=app_glob['async_ctx'],
                                    init=False, worker_pid=pid)
        else:
            key = get_key()
            port = find_port()
            cRpy = client_Rpy_async("ipc:///tmp/feeds/rpy2_clients", port,
                                    ctx=app_glob['async_ctx'])
            g2.keys_mapping[key] = port, cRpy.worker_process.pid
            sess['rpy2_session'] = key
        if rcommande == "CLOSE":
#            print('before')
            yield from cRpy.disconnect_close()
#            print('after')
            g2.keys_mapping.pop(sess['rpy2_session'])
            sess.pop('rpy2_session')
            print('g2.keys_mapping :', g2.keys_mapping)
            return web.Response(text=json.dumps(
                {'Status': 'Disconnected',
                 'Result': "Reload the page to get a new session"}))
        else:
            print('g2.keys_mapping :', g2.keys_mapping)
            message = yield from cRpy.reval(rcommande.replace('\r', ''))
            return web.Response(text=message.decode())

class R_console(web.View):
    @aiohttp_jinja2.template('R_form_console.html')
    @asyncio.coroutine
    def get(self):
        R_form = RstatementForm()
        content = ''
        return {'form': R_form, 'content': content}

    @asyncio.coroutine
    def post(self):
        R_form = RstatementForm()
        content = ''
        if R_form.validate():
            rcommande = yield from self.request.post()
            rcommande = rcommande['rcommande']
            print(g2.keys_mapping)
            sess = yield from get_session(self.request)
            if 'R_session' in sess and sess['R_session'] in g2.keys_mapping:
                key = sess['R_session']
                port, pid = g2.keys_mapping[key]
                r = rClient_async(port, ctx=app_glob['async_ctx'],
                                  init=False, key=key, pid=pid)
            else:
                port = find_port()
                key = get_key()
                r = rClient_async(port, ctx=app_glob['async_ctx'],
                                  init=True, key=key)
                g2.keys_mapping[key] = port, r.process.pid
                sess['R_session'] = key
            message = yield from r.rEval(rcommande.replace('\r', '').encode())
            content = message.decode()
            if "exiting R" in content:
                g2.keys_mapping.pop(sess['R_session'])
                r.manual_disconnect()
                sess.pop('R_session')
                content += " - Reload the page to get a new session"
            return web.Response(text=json.dumps({'Result': content,
                                                 'Status': 'OK'}))

@asyncio.coroutine
def clear_r_session(request):
    session = yield from get_session(request)
    posted_data = yield from request.post()
    print('session : ', session, '\nposted_data : ', posted_data)
    if 'rpy2_session' in posted_data:
        g2.keys_mapping.pop(session['rpy2_session'])
        session.pop('rpy2_session')
    elif 'R_session' in posted_data:
        g2.keys_mapping.pop(session['R_session'])
        session.pop('R_session')
    return web.Response(text=json.dumps({'Status': 'Done'}))


##########################################################
#### A few functions to open (server side) a table or
#### ... a geo layer uploaded by the user and display
#### ... some informations.
##########################################################
#### These functions are currently totaly insecure

def savefile(path, raw_data):
    # Todo : insert some data validation tests
    if '.shp' in path or '.dbf' in path or '.shx' in path:
        with open(path, 'wb') as f:
            f.write(raw_data)
    else:
        with open(path, 'w') as f:
            f.write(raw_data.decode())

def shp_to_geojson(filepath, to_latlong=True):
    # Todo : Rewrite using asyncio.subprocess methods
#    print("Here i am with ", filepath)
    if to_latlong:
        process = Popen(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326",
                         "/dev/stdout", filepath], stdout=PIPE)
    else:
        process = Popen(["ogr2ogr", "-f", "GeoJSON",
                         "/dev/stdout", filepath], stdout=PIPE)
    stdout, _ = process.communicate()
    return stdout.decode()

def geojson_to_topojson(filepath):
    # Todo : Rewrite using asyncio.subprocess methods
    # Todo : Use topojson python port if possible to avoid writing a temp. file
    process = Popen(["topojson", "--width", "1000",
                     "--height", "1000", "--cartesian",
                     filepath], stdout=PIPE)
    stdout, _ = process.communicate()
    return stdout.decode()

class UploadFile(web.View):
    """
    It accepts single files (geojson, topojson, csv, tsv, txt,
            or the 3 mandatory files for a Shapefile layer : .shp, .shx, .dbf).
    Mixing types and multi-upload (except the necessary one for Shapefile) are
    not allowed.
    """
    @aiohttp_jinja2.template('upload_srv.html')
    @asyncio.coroutine
    def get(self):
        return {'content_d': '', 'raw_result': ''}

    @aiohttp_jinja2.template('upload_srv.html')
    @asyncio.coroutine
    def post(self):
        filenames = []
        posted_data = yield from self.request.post()
        files_to_upload = posted_data.getall('file[]')
        if isinstance(files_to_upload[0], web_reqrep.FileField):
            alert = self.validate_upload_set(files_to_upload)
            if alert:
                return {'content_d': alert, 'raw_result': ''}
            for file in files_to_upload:
                if file and file[0]:
                    filename = file[1]
                    if not isinstance(file[2], str):
                        savefile(os.path.join(g2.app_real_path,
                                              g2.UPLOAD_FOLDER,
                                              filename), file[2].read())
                    else:
                        savefile(os.path.join(g2.app_real_path,
                                              g2.UPLOAD_FOLDER,
                                              filename), file[2].encode())
                    filenames.append(filename)
                else:
                    continue
        elif files_to_upload[0] == '0':  # Data are coming from the drag and drop zone
            raw_buff = b64decode(files_to_upload[2])
            try:
                loaded = json.loads(raw_buff)
                if 'type' in loaded and loaded['type'] == 'Topology':
                    ext = '.topojson'
                elif 'features' in loaded and 'type' in loaded:
                    ext = '.geojson'
                filename = 'tmp_{}{}'.format(get_name(), ext)
            finally:
                savefile(os.path.join(g2.app_real_path,
                                      g2.UPLOAD_FOLDER,
                                      filename), raw_buff)
                filenames.append(filename)
        if len(filenames) > 0:
            try:
                content, raw_result = self.uploaded_file_summary(filename)
            except Exception as err:
                content = 'Something wrong appened :\n{}'.format(err)
                raw_result = ''
            return {'content_d': content, 'raw_result': raw_result}
        else:
            return {'content_d': 'Unexpected error', 'raw_result': ''}

    @staticmethod
    def uploaded_file_summary(filename):
        infos, file = '', None
        raw_result = ''
        trans_rule = str.maketrans('', '', '[()]')
        try:
            basename, ext = filename.split('.')
        except ValueError:
            basename = filename
            ext = 'geojson'
        if ext in ('shp', 'dbf', 'shx'):
            filepath = os.path.join(
                g2.app_real_path, g2.UPLOAD_FOLDER, basename+'.shp')
            file = fiona.open(filepath)
            format_file = 'ESRI Shapefile'
            layers = basename
            nb_features = len(file)
            if 'init' in file.crs:
                crs = file.crs['init']
            else:
                crs = file.crs
            type_geom = file.schema['geometry']
            infos = repr(file.schema)
            raw_result = shp_to_geojson(filepath)
        elif ext in 'topojson':
            filepath = os.path.join(
                g2.app_real_path, g2.UPLOAD_FOLDER, filename)
            file = open(filepath)
            datajs = json.loads(file.read())
            format_file = datajs['type']
            layers = [i for i in datajs['objects'].keys()]
            nb_features = \
                [len(datajs['objects'][lyr]['geometries']) for lyr in layers]
            type_geom = set.union(*[set(
                rec['type'] for rec in datajs['objects'][lyr]['geometries'])
                                    for lyr in layers])
            crs = "EPSG:4326"
            raw_result = topo_to_geo(datajs)
        elif ext in ('json', 'geojson'):
            filepath = \
                os.path.join(g2.app_real_path, g2.UPLOAD_FOLDER, filename)
            file = fiona.open(filepath)
            format_file = 'GeoJSON'
            layers = basename
            nb_features = len(file)
            if 'init' in file.crs:
                crs = file.crs['init']
            else:
                crs = file.crs
            type_geom = file.schema['geometry']
            with open(filepath, 'r') as f:
                raw_result = f.read()
        elif ext in ('csv', 'txt', 'tsv'):
            layers, format_file = basename, ext
            filepath = \
                os.path.join(g2.app_real_path, g2.UPLOAD_FOLDER, filename)
            sep = guess_separator(filepath)
            file = pd.read_csv(filepath, sep=sep)
            infos = str(file.info())
            crs, type_geom, nb_features = \
                'NA', 'NA', "{} rows x {} columns".format(*file.shape)
        if not isinstance(file, pd.DataFrame):
            try:
                file.close()
            except Exception as err: print(err)
        if file is not None:  # Because "The truth value of a DataFrame is ambiguous"
            infos = infos + """<br><b>Format:</b><br>{}<br><b>Layers:</b><br>{}
                               <br><b>Nb features:</b><br>{}
                               <br><b>Geometrie Type(s):</b><br>{}
                               <br><b>Coordinate system:</b><br>{}
                """.format(format_file, layers, nb_features, type_geom, crs)
        else:
            infos = "Something unexpected append"
        return '<div>'+infos.translate(trans_rule).replace('\n', '<br>')+'</div>', raw_result

    @staticmethod
    def validate_upload_set(files_to_upload):
        alert = ""
        if len(files_to_upload) > 1 \
                and not any(['shp' in file[1] or 'dbf' in file[1]
                             for file in files_to_upload]):
            alert = """<script>
                alert("Layers have to be uploaded one by one")
                </script>"""
        elif len(files_to_upload) < 3 \
                and any(['shp' in file[1] or 'dbf' in file[1]
                         for file in files_to_upload]):
            alert = ("<script>"
                     "alert('Associated files (.dbf, .shx and .prj) have "
                     "to be provided with the Shapefile')</script>")
        elif any(['shp' in file[1] or 'dbf' in file[1]
                  for file in files_to_upload]) and \
                any(['json' in file[1] or 'csv' in file[1]
                     for file in files_to_upload]):
            alert = """<script>
                alert("Layers have to be uploaded one by one")
                </script>"""
        return alert

##########################################################
#### Quick views to wrap "flows" functionnalities :

class FlowsPage(web.View):
    @aiohttp_jinja2.template('default_page_form.html')
    @asyncio.coroutine
    def get(self):
        flows_form = FlowsForm()
        return {'form': flows_form, 'title': 'Flows page example'}

    @aiohttp_jinja2.template('default_page_form.html')
    @asyncio.coroutine
    def post(self):
        posted_data = yield from self.request.post()
        id_ = yield from is_known_user(self.request, ref=g2.table_map)
        flows_form = FlowsForm(posted_data)
        form_data = flows_form.data
        print(form_data)
        if not g2.table_map[id_][1]:
            file_to_upload = posted_data.get('table')
            filename = 'table_' + str(abs(hash(id_)))
            real_path = \
                os.path.join(g2.app_real_path, g2.UPLOAD_FOLDER, filename)
            savefile(real_path, file_to_upload[2].read())
            try:
                g2.table_map[id_][1] = real_path
                sep = guess_separator(real_path)
                df = pd.read_csv(real_path, sep=sep)
                headers = list(df.columns)
                print('Before : ', headers)
                if 'Unnamed: 0' in headers[0]:
                    headers = headers[1:]
                headers_fields = list(zip(headers, headers))
                suite = flows_form.next_field.append_entry()
                suite.field_i.choices = headers_fields
                suite.field_j.choices = headers_fields
                suite.field_fij.choices = headers_fields
                content = '<div>' + df.head(15).to_html().replace('\n', '') + '</div>'
            except Exception as err:
                print(err)
                content = str(err)
            return {'form': flows_form, 'content': content,
                    'title': 'Flows page example'}
        else:
            nform = form_data['next_field'][0]
            commande = (b"prepflows_json(mat, i, j, fij, "
                        b"remove_diag, direct_stat)")
            filename = g2.table_map[id_][1]
            print(pp, filename)
            data = json.dumps({
                'mat': filename,
                'i': nform['field_i'],
                'j': nform['field_j'],
                'fij': nform['field_fij'],
                'remove_diag': False,
                'direct_stat': {
                    "direct_stat": True, "output": 'none', "verbose": True}
                }).encode()
            content = yield from R_client_fuw_async(
                url_client, commande, data, app_glob['async_ctx'], id_)
            print(pp, content)
            res = json.loads(content.decode())
            summary = '<br>'.join([i for i in res])
            return {'form': flows_form,
                    'content': "<b>Summary:</b><br>" + summary,
                    'title': 'Flows page example'}

##########################################################
#### Qucik views to wrap "SpatialPosition" functionnalities :

class StewartPage(web.View):
    @aiohttp_jinja2.template('default_page_form.html')
    @asyncio.coroutine
    def get(self):
        stewart_form = SpatialPos_Form()
        return {'form': stewart_form, 'content': '',
                'title' : 'Stewart Example'}

    @aiohttp_jinja2.template('display_result.html')
    @asyncio.coroutine
    def post(self):
        posted_data = yield from self.request.post()
        stewart_form = SpatialPos_Form(posted_data)
        if not stewart_form.validate():
            return web.Response(text="Invalid input fields")

        filenames = {}  # Following code is probably totally insecure to deal with user inputs :
        for file_ph in ('point_layer', 'mask_layer'):
            file_to_upload = self.request.POST[file_ph]
            if file_to_upload:
                filepath = os.path.join(
                    g2.app_real_path, g2.UPLOAD_FOLDER, file_to_upload[1])
                savefile(filepath, file_to_upload[2].read())
                filenames[file_ph] = filepath
            else:
                filenames[file_ph] = 'NULL'
        form_data = stewart_form.data
        id_ = yield from is_known_user(self.request)
        commande = (b'stewart_to_json(knownpts_json, varname, typefct, span, '
                    b'beta, nclass, resolution, mask_json)')
        data = json.dumps({
            'knownpts_json': filenames['point_layer'],
            'varname': form_data['var_name'],
            'typefct': form_data['type_fun'],
            'span': form_data['span'],
            'beta': form_data['beta'],
            'nclass': form_data['nclass'],
            'resolution': form_data['resolution'],
            'mask_json': filenames['mask_layer']
            }).encode()

        content = yield from R_client_fuw_async(
            url_client, commande, data, app_glob['async_ctx'], id_)
        content = json.loads(content.decode())
        return {'content': json.dumps(content['geojson']),
                'breaks': content['breaks'],
                'title': 'Stewart Result'}

#class ReillyPage(web.View):
#    @aiohttp_jinja2.template('sPosition.html')
#    @asyncio.coroutine
#    def get(self):
#        hform = SpatialPos_Form()
#        return {'form': hform, 'content': '', 'title' : 'Reilly Example'}
#
#    @aiohttp_jinja2.template('display_result.html')
#    @asyncio.coroutine
#    def post(self):
#        posted_data = yield from self.request.post()
#        hform = SpatialPos_Form(posted_data)
#        if not hform.validate():
#            return web.Response(text="Invalid input fields")
#
#        filenames = {}  # Following code is probably totally insecure to deal with user inputs :
#        for file_ph in ('point_layer', 'mask_layer'):
#            file_to_upload = self.request.POST[file_ph]
#            if file_to_upload:
#                filepath = os.path.join(g2.app_real_path, g2.UPLOAD_FOLDER, file_to_upload[1])
#                savefile(filepath, file_to_upload[2].read())
#                filenames[file_ph] = filepath
#            else:
#                filenames[file_ph] = 'NULL'
#        form_data = hform.data
#        id_ = yield from is_known_user(self.request)
#        commande = (b'reilly_to_json(knownpts_json, unknownpts_json, '
#                                    b'matdist, varname, typefct, span, '
#                                    b'beta, resolution, longlat, mask_json)')
#        data = json.dumps({
#            'knownpts_json': filenames['point_layer'],
#            'unknownpts_json': None,
#            'matdist': None,
#            'varname': form_data['var_name'],
#            'typefct': form_data['type_fun'],
#            'span': form_data['span'],
#            'beta': form_data['beta'],
#            'resolution': form_data['resolution'],
#            'longlat': False,
#            'mask_json': filenames['mask_layer']
#            }).encode()
#        content = R_client_fuw(url_client, commande, data, g2.context, id_)
#        print('content : ', content)
#        return {'content': content.decode(), 'title': 'Reilly Result'}

##########################################################
#### Qucik views to wrap "MTA" functionnalities :

class MTA_globalDev(web.View):
    @asyncio.coroutine
    @aiohttp_jinja2.template('MTA_dev.html')
    def get(self):
        gbd_form = MTA_form_global()
        return {'form': gbd_form, 'title': 'MTA Global Dev. Example'}

    @asyncio.coroutine
    def post(self):
        posted_data = yield from self.request.post()
        # Using the prepared WTForm allow to fetch the values
        # with the good datatype :
        gbd_form = MTA_form_global(posted_data)
        if not gbd_form.validate():
            return web.Response(text="Invalid input fields")
        form_data = gbd_form.data
        commande = b'mta_globaldev(x, var1, var2, ref, type_dev)'
        data = json.dumps({
            'x': form_data['json_df'], 'var1': form_data['var1'],
            'var2': form_data['var2'], 'ref': form_data['ref'],
            'type_dev': form_data['type_fun']
            }).encode()
        id_ = yield from is_known_user(self.request)
        content = yield from R_client_fuw_async(
            url_client, commande, data, app_glob['async_ctx'], id_)
        return web.Response(text=content.decode())

class MTA_mediumDev(web.View):
    @asyncio.coroutine
    @aiohttp_jinja2.template('MTA_dev.html')
    def get(self):
        meddev_form = MTA_form_medium()
        return {'form': meddev_form, 'title': 'MTA Medium Dev. Example'}

    @asyncio.coroutine
    def post(self):
        posted_data = yield from self.request.post()
        meddev_form = MTA_form_medium(posted_data)
        if not meddev_form.validate():
            return web.Response(text="Invalid input fields")
        form_data = meddev_form.data
        commande = b'mta_mediumdev(x, var1, var2, key, type_dev)'
        data = json.dumps({
            'x': form_data['json_df'].replace('\n', '').replace('\r', ''),
            'var1': form_data['var1'], 'var2': form_data['var2'],
            'key': form_data['key'], 'type_dev': form_data['type_fun']
            }).encode()
        id_ = yield from is_known_user(self.request)
        content = yield from R_client_fuw_async(
            url_client, commande, data, app_glob['async_ctx'], id_)
        return web.Response(text=content.decode())

class MTA_localDev(web.View):
    @asyncio.coroutine
    @aiohttp_jinja2.template('MTA_dev.html')
    def get(self):
        locdev_form = MTA_form_local()
        return {'form': locdev_form, 'title': 'MTA Local Dev. Example'}

    @asyncio.coroutine
    def post(self):
        posted_data = yield from self.request.post()
        locdev_form = MTA_form_local(posted_data)
        if not locdev_form.validate():
            return web.Response(text="Invalid input fields")
        form_data = locdev_form.data
        if not form_data['distance'] and not form_data['order']:
            return web.Response(text="Invalid input fields"
                                     "(Order or Distance have to be set)")
        commande = \
            b'mta_localdev(spdf_geojs, var1, var2, order, dist, type_dev)'
        data = json.dumps({
            'spdf_geojs': form_data['geojs'],
            'var1': form_data['var1'],
            'var2': form_data['var2'],
            'order': form_data['order'],
            'dist': form_data['distance'],
            'type_dev': form_data['type_fun']}).encode()
        id_ = yield from is_known_user(self.request)
        content = yield from R_client_fuw_async(
            url_client, commande, data, app_glob['async_ctx'], id_)
        # Todo : Convert the result to TopoJSON
        return web.Response(text=content.decode())


# Todo : Create a customizable route (like /convert/{format_Input}/{format_output})
# to easily handle file types send by the front-side ?
@asyncio.coroutine
def convert(request):
    posted_data = yield from request.post()
    datatype, data = posted_data.getall('file[]')
    name = get_name(length=32)
    filepath = os.path.join(g2.app_real_path, g2.UPLOAD_FOLDER, name)
    if 'zip' in datatype:
        with open(filepath+'archive', 'wb') as f:
            f.write(b64decode(data))
        with ZipFile(filepath+'archive') as myzip:
            list_files = myzip.namelist()
            list_files = ['/tmp/' + i for i in list_files]
            myzip.extractall(path='/tmp')
            res = shp_to_geojson(
                os.path.join([i for i in list_files if 'shp' in i][0]),
                to_latlong=False)
            filepath2 = '/tmp/'+get_name()
            with open(filepath2, 'w') as f:
                f.write(res)
            result = geojson_to_topojson(filepath2)
        os.remove(filepath+'archive')
        os.remove(filepath2)
        [os.remove(file) for file in list_files]

    elif 'octet-stream;base64' in datatype:
        print(datatype)
        with open(filepath, 'w') as f:
            f.write(b64decode(data).decode())
        result = geojson_to_topojson(filepath)
        os.remove(filepath)
    else:
        result = json.dumps({'Result': 'Incorrect datatype'})
    return web.Response(text=result)

class R_commande(web.View):
    @asyncio.coroutine
    def get(self):
        function = self.request.match_info['function']
        params = self.request.match_info['params']
        print(function)
        print(type(params))
        params = [i for i in params.split('&')]
        commande = [function, '(']
        data = {}
        for param in params:
            p = param.split('=')
            if len(p) < 2:
                continue
            commande.extend([p[0], '=', p[0], ','])
            try:
                data[p[0]] = float(p[1])
            except:
                data[p[0]] = p[1]
        commande.pop()
        commande.append(')')
        commande = ''.join(commande).encode()
        id_ = yield from is_known_user(self.request)
        print(data)
        data = json.dumps(data).encode()
        content = yield from R_client_fuw_async(
            url_client, commande, data, app_glob['async_ctx'], id_)
        return web.Response(text=content.decode())


app = web.Application(middlewares=[session_middleware(
    EncryptedCookieStorage(b'aWM\\PcrlZwfrMW^varyDtKIeMkNnkgQv'))])
#    aiohttp_debugtoolbar.setup(app)
aiohttp_jinja2.setup(app, loader=jinja2.FileSystemLoader('templates'))
app.router.add_route('GET', '/', handler)
app.router.add_route('GET', '/index2', handler2)
app.router.add_route('*', '/upload', UploadFile)
app.router.add_route('*', '/R/{function}/{params}', R_commande)
app.router.add_route('*', '/R_console', R_console)
app.router.add_route('*', '/R_console/', R_console)
app.router.add_route('*', '/Rpy2_console', Rpy2_console)
app.router.add_route('*', '/Rpy2_console/', Rpy2_console)
app.router.add_route('POST', '/clear_R_session', clear_r_session)
app.router.add_route('POST', '/convert_to_topojson', convert)
app.router.add_route('*', '/R/wrapped/flows/int', FlowsPage)
app.router.add_route('*', '/R/wrapped/SpatialPosition/stewart', StewartPage)
#    app.router.add_route('*', '/R/wrapped/SpatialPosition/reilly', ReillyPage)
app.router.add_route('*', '/R/wrapped/MTA/globalDev', MTA_globalDev)
app.router.add_route('*', '/R/wrapped/MTA/mediumDev', MTA_mediumDev)
app.router.add_route('*', '/R/wrapped/MTA/localDev', MTA_localDev)
app.router.add_static('/modules/', path='templates/modules', name='modules')
app.router.add_static('/static/', path='static', name='static')
app.router.add_static('/database/', path='../database', name='database')

if not os.path.isdir('/tmp/feeds'):
    try:
        os.mkdir('/tmp/feeds')
    except Exception as err:
        print(err)
        sys.exit()
# The mutable mapping it provides will be used to store (safely ?)
# some global variables :
app_glob = web.Application()

def init_R_workers(nb_workers):
    r_process = prepare_worker(nb_workers)
    app['broker'] = threading.Thread(
        target=launch_async_broker, args=(len(r_process), None))
    app['broker'].start()
## Todo : find a better way to launch the broker
init_R_workers(2)

#    if not 'thread_q' in app_glob:
def init_Rpy2_console_broker():
    app['thread_q'] = threading.Thread(
        target=launch_queue, args=("ipc:///tmp/feeds/rpy2_clients", ))
    app['thread_q'].start()
# Todo : refactor this ugly launcher of the broker (and refactor the broker itself!)
init_Rpy2_console_broker()

# In order to get an async zmq context object for the clients without using the zmq event loop:
zmq.asyncio.install()
app['async_ctx'] = zmq.asyncio.Context(3) # It will be use to launch the rClient_async object

