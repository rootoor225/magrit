# -*- coding: utf-8 -*-
"""
@author: mz
"""
from geopandas import GeoDataFrame
from shapely.geometry import Polygon
from math import ceil
from shapely.ops import cascaded_union
from shapely.prepared import prep


def make_grid(gdf, height):
    """
    Return a grid, based on the shape of *gdf* and on a *resolution* value.

    Parameters
    ----------
    gdf: GeoDataFrame
        The collection of polygons to be covered by the grid.
    resolution: Int
        The resolution (in units of `gdf`).

    Returns
    -------
    grid: GeoDataFrame
        A collection of polygons all belonging in `gdf`.
    """
    xmin, ymin, xmax, ymax = gdf.total_bounds
    rows = ceil((ymax-ymin) / height)
    cols = ceil((xmax-xmin) / height)

    x_left_origin = xmin
    x_right_origin = xmin + height
    y_top_origin = ymax
    y_bottom_origin = ymax - height

    res_geoms = []
    for countcols in range(cols):
        y_top = y_top_origin
        y_bottom = y_bottom_origin
        for countrows in range(rows):
            res_geoms.append(Polygon([
                (x_left_origin, y_top), (x_right_origin, y_top),
                (x_right_origin, y_bottom), (x_left_origin, y_bottom)
                ]))
            y_top = y_top - height
            y_bottom = y_bottom - height
        x_left_origin = x_left_origin + height
        x_right_origin = x_right_origin + height

    mask = cascaded_union(gdf.geometry).buffer(5).buffer(-5)
    _mask = prep(mask)

    return GeoDataFrame(
        crs=gdf.crs,
        geometry=[x.intersection(mask) for x in res_geoms if _mask.intersects(x)]
        )


def get_grid_layer(input_file, resolution, field_name):
    proj4_eck4 = ("+proj=eck4 +lon_0=0 +x_0=0 +y_0=0 "
                  "+ellps=WGS84 +datum=WGS84 +units=m +no_defs")

    gdf = GeoDataFrame.from_file(input_file)
    gdf.to_crs(crs=proj4_eck4, inplace=True)

    grid = make_grid(gdf, resolution)

    grid["densitykm"] = 0.0
    grid["cell_area"] = grid.area / 1000000
    for i, cell in enumerate(grid.geometry):
        idx = gdf.geometry.intersects(cell)
#        idx = idx[idx].index
        areas = geoms[idx].intersection(cell).area.values / geoms[idx].area.values
        values = gdf[field_name][idx].values
        grid.loc[(i, 'densitykm')] = (values / areas).sum()
    grid["densitykm"] = grid["densitykm"] / grid["cell_area"]

    return grid.to_crs({'init': 'epsg:4326'})


def get_grid_layer2(input_file, resolution, field_name, output="GeoJSON"):
    def compute_density(x):
        nonlocal geoms, array_values
        idx = geoms.intersects(x)
        idx = idx[idx].index
        areas_p = geoms[idx].intersection(x).area.values / geoms[idx].area.values
#        values = array_values[idx]
        return (array_values[idx] * areas_p).sum() / x.area

    proj4_eck4 = ("+proj=eck4 +lon_0=0 +x_0=0 +y_0=0 "
                  "+ellps=WGS84 +datum=WGS84 +units=m +no_defs")

    gdf = GeoDataFrame.from_file(input_file)
    gdf.to_crs(crs=proj4_eck4, inplace=True)
#    gdf[field_name] = gdf[field_name].astype(float)
#    gdf = gdf.reindex([i for i in range(len(gdf))])
    grid = make_grid(gdf, resolution)

    geoms = gdf.geometry
    array_values = gdf[field_name].values
    density_field_name = "".join([field_name, "_density"])

    grid["id"] = [i for i in range(len(grid))]
    grid[density_field_name] = grid.geometry.apply(compute_density)
    grid["densitykm"] = grid[density_field_name] * 1000000
#    grid["cell_area"] = grid.area
#    grid[density_field_name] = grid[density_field_name] / grid["cell_area"]

    return grid.to_crs({'init': 'epsg:4326'}).to_json() if "GeoJSON" in output\
        else grid.to_crs({'init': 'epsg:4326'})


def get_grid_layer3(input_file, height, field_name):
    proj4_eck4 = ("+proj=eck4 +lon_0=0 +x_0=0 +y_0=0 "
                  "+ellps=WGS84 +datum=WGS84 +units=m +no_defs")

    gdf = GeoDataFrame.from_file(input_file)
    gdf.to_crs(crs=proj4_eck4, inplace=True)

    xmin, ymin, xmax, ymax = gdf.total_bounds
    rows = ceil((ymax-ymin) / height)
    cols = ceil((xmax-xmin) / height)

    x_left_origin = xmin
    x_right_origin = xmin + height
    y_top_origin = ymax
    y_bottom_origin = ymax - height

    mask = cascaded_union(gdf.geometry).buffer(5).buffer(-5)
    _mask = prep(mask)
    geoms = gdf.geometry
    array_values = gdf[field_name].values

    res = []
    for countcols in range(cols):
        y_top = y_top_origin
        y_bottom = y_bottom_origin
        for countrows in range(rows):
            p = Polygon([
                (x_left_origin, y_top), (x_right_origin, y_top),
                (x_right_origin, y_bottom), (x_left_origin, y_bottom)
                ])
            if _mask.intersects(p):
                p = p.intersection(mask)
                idx = geoms.intersects(p)
                idx = idx[idx].index
                areas_part = geoms[idx].intersection(p).area.values / geoms[idx].area.values
                values = array_values[idx]
                density = (values * areas_part).sum() / p.area
                res.append((p, density))
            y_top = y_top - height
            y_bottom = y_bottom - height
        x_left_origin = x_left_origin + height
        x_right_origin = x_right_origin + height

    n_field_name = "".join([field_name, "_density"])

    return GeoDataFrame(data={n_field_name: [i[1] for i in res]},
        geometry=[i[0] for i in res]
        ).to_crs({'init': 'epsg:4326'})
