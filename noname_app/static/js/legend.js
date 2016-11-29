"use strict";
/**
* Function called on clicking on the legend button of each layer
* - toggle the visibility of the legend (or create the legend if doesn't currently exists)
*
* @param {String} layer - The layer name
*
*/
function handle_legend(layer){
    let state = current_layers[layer].renderer;
    if(state != undefined){
        let class_name = [".lgdf", layer].join('_');
        if(d3.selectAll(class_name).node()){
            if(!d3.selectAll(class_name).attr("display"))
                d3.selectAll(class_name).attr("display", "none");
            else {
                d3.selectAll(class_name).attr("display", null);
                // Redisplay the legend(s) and also
                // verify if still in the visible part
                // of the map, if not, move them in:
                // .. so it's actually a feature if the legend is redrawn on its origin location
                // after being moved too close to the outer border of the map :
                let tol = 7.5,
                    map_xy0 = get_map_xy0(),
                    limit_left = map_xy0.x - tol,
                    limit_right = map_xy0.x + +w + tol,
                    limit_top = map_xy0.y - tol,
                    limit_bottom = map_xy0.y + +h + tol;
                let legends = svg_map.getElementsByClassName(class_name.slice(1, class_name.length));
                for(let i = 0; i < legends.length; i++){
                    let bbox_legend = legends[i].getBoundingClientRect();
                    if(bbox_legend.left < limit_left || bbox_legend.right > limit_right
                            || bbox_legend.top < limit_top || bbox_legend.bottom > limit_bottom)
                        legends[i].setAttribute("transform", "translate(0, 0)");
                }
            }
        } else {
            createLegend(layer, "")
        }
    }
}

/**
* Function called on the first click on the legend button of each layer
* - delegate legend creation according to the type of function
*
* @param {String} layer - The layer name
* @param {String} title - The desired title (default: empty - can be modified later)
*
*/
function createLegend(layer, title){
    var renderer = current_layers[layer].renderer,
        field = current_layers[layer].rendered_field,
        field2 = current_layers[layer].rendered_field2;

    if(renderer.indexOf("PropSymbolsChoro") != -1
        || renderer.indexOf("PropSymbolsTypo") != -1){
        createLegend_choro(layer, field2, title, field2, 0);
        createLegend_symbol(layer, field, title, field);
    }
    else if(renderer.indexOf("PropSymbols") != -1
            || renderer.indexOf("DorlingCarto") != -1)
        createLegend_symbol(layer, field, title, field);

    else if (renderer.indexOf("Links") != -1
            || renderer.indexOf("DiscLayer") != -1)
        createLegend_discont_links(layer, field, title, field);

    else if (renderer.indexOf("Choropleth") > -1)
        createLegend_choro(layer, field, title, field, 0);

    else if (current_layers[layer].colors_breaks
            || current_layers[layer].color_map || current_layers[layer].symbols_map)
        createLegend_choro(layer, field, title, field, 0);

    else if (renderer.indexOf("Carto_doug") != -1)
        createLegend_nothing(layer, field, "Dougenik Cartogram", field);

    else
        swal("Oups..!",
             i18next.t("No legend available for this representation") + ".<br>"
             + i18next.t("Want to make a <a href='/'>suggestion</a> ?"),
             "warning");
}

function up_legend(legend_node){
    let lgd_features = svg_map.getElementsByClassName("legend"),
        nb_lgd_features = +lgd_features.length,
        self_position;
    for(let i=0; i<nb_lgd_features; i++){
        if(lgd_features[i].id == legend_node.id
            && lgd_features[i].classList == legend_node.classList){
                self_position = i;
        }
    }
    if(self_position == nb_lgd_features - 1){
        return;
    } else {
        svg_map.insertBefore(lgd_features[self_position + 1], lgd_features[self_position]);
    }
}

function down_legend(legend_node){
    let lgd_features = svg_map.getElementsByClassName("legend"),
        nb_lgd_features = +lgd_features.length,
        self_position;
    for(let i=0; i<nb_lgd_features; i++){
        if(lgd_features[i].id == legend_node.id
            && lgd_features[i].classList == legend_node.classList){
                self_position = i;
        }
    }
    if(self_position == 0){
        return;
    } else {
        svg_map.insertBefore(lgd_features[self_position], lgd_features[self_position - 1]);
    }
}

function make_legend_context_menu(legend_node, layer){
   let context_menu = new ContextMenu(),
       getItems = () =>  [
        {"name": i18next.t("app_page.common.edit_style"), "action": () => {  createlegendEditBox(legend_node.attr("id"), layer);  }},
        {"name": i18next.t("app_page.common.up_element"), "action": () => {  up_legend(legend_node.node());  }},
        {"name": i18next.t("app_page.common.down_element"), "action": () => { down_legend(legend_node.node()); }},
        {"name": i18next.t("app_page.common.hide"), "action": () => {
            if(!legend_node.attr("display"))
                legend_node.attr("display", "none");
            else
                legend_node.attr("diplay", null);
        }}
    ];
    legend_node.on("dblclick", () => {
        d3.event.stopPropagation();
        d3.event.preventDefault();
        createlegendEditBox(legend_node.attr("id"), layer);
        });

    legend_node.on("contextmenu", () => {
        context_menu.showMenu(d3.event,
                              document.querySelector("body"),
                              getItems());
        });
}

var drag_legend_func = function(legend_group){
    return d3.drag()
             .subject(function() {
                    var t = d3.select(this),
                        prev_translate = t.attr("transform");
                    prev_translate = prev_translate ? prev_translate.slice(10, -1).split(',').map(f => +f) : [0, 0];
                    return {
                        x: t.attr("x") + prev_translate[0], y: t.attr("y") + prev_translate[1],
                        map_locked: map_div.select("#hand_button").classed("locked") ? true : false,
                        map_offset: get_map_xy0()
                    };
                })
            .on("start", () => {
                d3.event.sourceEvent.stopPropagation();
                d3.event.sourceEvent.preventDefault();
                handle_click_hand("lock");
              })
            .on("end", () => {
                if(d3.event.subject && !d3.event.subject.map_locked)
                  handle_click_hand("unlock");
                legend_group.style("cursor", "grab");
              })
            .on("drag", () => {
                let prev_value = legend_group.attr("transform");
                prev_value = prev_value ? prev_value.slice(10, -1).split(',').map(f => +f) : [0, 0];
                legend_group.attr('transform', 'translate(' + [d3.event.x, d3.event.y] + ')')
                        .style("cursor", "grabbing");

                let bbox_elem = legend_group.node().getBoundingClientRect(),
                    map_offset = d3.event.subject.map_offset,
                    val_x = d3.event.x, val_y = d3.event.y, change;

                if(bbox_elem.x < map_offset.x || bbox_elem.x + bbox_elem.width > map_offset.x + w){
                    val_x = prev_value[0];
                    change = true;
                }
                if(bbox_elem.y < map_offset.y || bbox_elem.y + bbox_elem.height > map_offset.y + h){
                    val_y = prev_value[1];
                    change = true;
                }
                if(change) legend_group.attr('transform', 'translate(' + [val_x, val_y] + ')');
              });
}

function createLegend_nothing(layer, field, title, subtitle, rect_fill_value){
    var subtitle = subtitle || field,
        space_elem = 18,
        boxgap = 12,
        xpos = 30,
        ypos = h / 2,
        tmp_class_name = ["legend", "legend_feature", "lgdf_" + layer].join(' '),
        legend_root = map.insert('g').attr('id', 'legend_root_nothing').attr("class", tmp_class_name).style("cursor", "grab");

    var rect_under_legend = legend_root.insert("rect");

    legend_root.insert('text').attr("id","legendtitle")
            .text(title || "Title").style("font", "bold 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + space_elem)
            .attr("y", ypos)

    legend_root.insert('text').attr("id","legendsubtitle")
            .text(subtitle).style("font", "italic 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + space_elem)
            .attr("y", ypos + 15);

    legend_root.call(drag_legend_func(legend_root));

    legend_root.append("g").attr("class", "legend_feature")
            .insert("text").attr("id", "legend_bottom_note")
            .attrs({x: xpos, y: ypos + 2*space_elem})
            .style("font", "11px 'Enriqueta', arial, serif")
            .html('');
    make_underlying_rect(legend_root, rect_under_legend, rect_fill_value);
    legend_root.select('#legendtitle').text(title || "");
    make_legend_context_menu(legend_root, layer);
}

function createLegend_discont_links(layer, field, title, subtitle, rect_fill_value){
    var space_elem = 18,
        boxgap = 12,
        xpos = 30,
        ypos = 30,
        y_pos2 =  ypos + space_elem,
        tmp_class_name = ["legend", "legend_feature", "lgdf_" + layer].join(' '),
        legend_root = map.insert('g').attr('id', 'legend_root_links').attr("class", tmp_class_name).style("cursor", "grab"),
        breaks = current_layers[layer].breaks,
        nb_class = breaks.length;

    var rect_under_legend = legend_root.insert("rect");

    legend_root.insert('text').attr("id","legendtitle")
            .text(title || "Title").style("font", "bold 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + space_elem)
            .attr("y", ypos)

    legend_root.insert('text').attr("id","legendsubtitle")
            .text(subtitle).style("font", "italic 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + space_elem)
            .attr("y", ypos + 15);

    let ref_symbols_params = [];

    // Prepare symbols for the legend, taking care of not representing values
    // under the display threshold defined by the user (if any) :
//    if(current_layers[layer].renderer == "Links"){
    let current_min_value = +current_layers[layer].min_display;
    for(let b_val of breaks){
        if (b_val[1] != 0) {
            if(current_min_value >= +b_val[0][0] && current_min_value < +b_val[0][1]) {
                ref_symbols_params.push({value:[current_min_value, b_val[0][1]], size:b_val[1]});
            } else if(current_min_value < +b_val[0][0] && current_min_value < +b_val[0][1]) {
                ref_symbols_params.push({value:b_val[0], size:b_val[1]});
            }
        }
    }
//    } else {
//        for(let b_val of breaks)
//            ref_symbols_params.push({value:b_val[0], size:b_val[1]});
//    }
    ref_symbols_params.reverse();

    var legend_elems = legend_root.selectAll('.legend')
                                  .append("g")
                                  .data(ref_symbols_params)
                                  .enter().insert('g')
                                  .attr('class', (d, i) => "legend_feature lg legend_" + i);

    let max_size = current_layers[layer].size[1],
        last_size = 0,
        last_pos = y_pos2,
        color = current_layers[layer].fill_color.single,
        xrect = xpos + space_elem + max_size / 2;

    legend_elems
          .append("rect")
          .attr("x", xrect)
          .attr("y", d => {
                last_pos = boxgap + last_pos + last_size;
                last_size = d.size;
                return last_pos;
                })
          .attr('width', 45)
          .attr('height', d => d.size)
          .styles({fill: color, stroke: "rgb(0, 0, 0)", "fill-opacity": 1, "stroke-width": 0})

    last_pos = y_pos2;
    last_size = 0;

    let x_text_pos = xpos + space_elem + max_size * 1.5 + 45;
    let tmp_pos;
    legend_elems.append("text")
        .attr("x", x_text_pos)
        .attr("y", d => {
                last_pos = boxgap + last_pos + last_size;
                last_size = d.size;
                tmp_pos = last_pos - (d.size / 4)
                return tmp_pos;
                })
        .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
        .text(d => d.value[1]);

    legend_root.insert('text').attr("id", "lgd_choro_min_val")
        .attr("x", x_text_pos)
        .attr("y", tmp_pos + boxgap)
        .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
        .text(ref_symbols_params[ref_symbols_params.length -1].value[0]);

    legend_root.call(drag_legend_func(legend_root));

    legend_root.append("g").attr("class", "legend_feature")
            .insert("text").attr("id", "legend_bottom_note")
            .attrs({x: xpos + space_elem, y: last_pos + 2*space_elem})
            .style("font", "11px 'Enriqueta', arial, serif")
            .html('');
    make_underlying_rect(legend_root, rect_under_legend, rect_fill_value);
    legend_root.select('#legendtitle').text(title || "");
    make_legend_context_menu(legend_root, layer);
}

/**
* Function computing the size of the rectangle to be put under the legend
* (called on each change modifying the size of the legend box,
* eg. longer title, switching to nested symbols, etc..)
*
*/
function make_underlying_rect(legend_root, under_rect, fill){
    under_rect.attrs({"width": 0, height: 0});
//    console.log(legend_root)
    let bbox_legend = legend_root.node().getBoundingClientRect(),
        translate = legend_root.attr("transform"),
        map_xy0 = get_map_xy0();

    translate = translate
            ? translate.split("translate(")[1].split(")")[0].split(",").map(d => +d)
            : [0, 0];

    let bbox = {
        x_top_left: bbox_legend.left - map_xy0.x - 5 - translate[0],
        y_top_left: bbox_legend.top - map_xy0.y - 5 - translate[1],
        x_top_right: bbox_legend.right - map_xy0.x + 5 - translate[0],
        y_top_right: bbox_legend.top - map_xy0.y - 5 - translate[1],
        x_bottom_left: bbox_legend.left - map_xy0.x - 5 - translate[0],
        y_bottom_left: bbox_legend.bottom - map_xy0.y + 5 - translate[1]
    }
    let rect_height = get_distance([bbox.x_top_left, bbox.y_top_left], [bbox.x_bottom_left, bbox.y_bottom_left]),
        rect_width = get_distance([bbox.x_top_left, bbox.y_top_left], [bbox.x_top_right, bbox.y_top_right]);

    under_rect.attrs({"class": "legend_feature", "id": "under_rect",
                      "height": rect_height, "width": rect_width});
    under_rect.attr("x", bbox.x_top_left).attr("y", bbox.y_top_left)

    if(!fill || (!fill.color || !fill.opacity)){
        under_rect.style("fill", "green")
                  .style("fill-opacity", 0);
        legend_root.attr("visible_rect", "false");
        legend_root.on("mouseover", ()=>{ under_rect.style("fill-opacity", 0.1); })
                   .on("mouseout", ()=>{ under_rect.style("fill-opacity", 0); });
    } else {
        under_rect.style("fill", fill.color)
                  .style("fill-opacity", fill.opacity);
        legend_root.attr("visible_rect", "true");
        legend_root.on("mouseover", null).on("mouseout", null);

    }
}

function createLegend_symbol(layer, field, title, subtitle, nested = "false", rect_fill_value){
    var space_elem = 18,
        boxgap = 4,
        xpos = 30,
        ypos = 30,
        y_pos2 =  ypos + space_elem * 1.5,
        ref_layer_name = current_layers[layer].ref_layer_name,
        nb_features = user_data[ref_layer_name].length,
        tmp_class_name = ["legend", "legend_feature", "lgdf_" + layer].join(' '),
        symbol_type = current_layers[layer].symbol;

    var color_symb_lgd = (current_layers[layer].renderer === "PropSymbolsChoro" || current_layers[layer].renderer === "PropSymbolsTypo")
                        ? "#FFF" : (current_layers[layer].fill_color.two !== undefined)
                        ? "#FFF" : current_layers[layer].fill_color.single;

    var legend_root = map.insert('g')
                        .attr('id', 'legend_root2')
                        .attr("class", tmp_class_name)
                        .attr("transform", "translate(0,0)")
                        .style("cursor", "grab");
    var rect_under_legend = legend_root.insert("rect");
    legend_root.insert('text').attr("id","legendtitle")
            .text(title).style("font", "bold 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + space_elem)
            .attr("y", ypos)
    legend_root.insert('text').attr("id","legendsubtitle")
            .text(subtitle).style("font", "italic 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + space_elem)
            .attr("y", ypos + 15);

    let ref_symbols = document.getElementById(layer).getElementsByTagName(symbol_type),
        type_param = symbol_type === 'circle' ? 'r' : 'width';

    let sqrt = Math.sqrt;

    // let id_ft_val_min = +Array.prototype.filter.call(ref_symbols, (d, i) => { if(d.r.baseVal.value != 0) return d.r.baseVal.value; })
    // // let id_ft_val_min = +ref_symbols[nb_features - 1].id.split(' ')[1].split('_')[1],
    //     id_ft_val_max = +ref_symbols[0].id.split(' ')[1].split('_')[1],
    //     size_max = +ref_symbols[nb_features - 1].getAttribute(type_param),
    //     size_min = +ref_symbols[0].getAttribute(type_param),
    //     val_min = Math.abs(+user_data[ref_layer_name][id_ft_val_min][field]),
    //     val_max = Math.abs(+user_data[ref_layer_name][id_ft_val_max][field]),
    let non_empty = Array.prototype.filter.call(ref_symbols, (d, i) => { if(d.r.baseVal.value != 0) return d.r.baseVal.value; }),
        size_max = +non_empty[0].getAttribute(type_param),
        size_min = +non_empty[non_empty.length - 1].getAttribute(type_param),
        val_max = Math.abs(+non_empty[0].__data__.properties[field]),
        val_min = Math.abs(+non_empty[non_empty.length - 1].__data__.properties[field]),
        nb_decimals = get_nb_decimals(val_max),
        diff_size = sqrt(size_max) - sqrt(size_min),
        diff_val = val_max - val_min,
        val_interm1 = val_min + diff_val / 3,
        val_interm2 = val_interm1 + diff_val / 3,
        size_interm1 = sqrt(size_min) + diff_size / 3,
        size_interm2 = size_interm1 + diff_size / 3,
        z_scale = +d3.zoomTransform(map.node()).k,
        ref_symbols_params = [
            {size: size_max * z_scale, value: val_max.toFixed(nb_decimals)},
            {size: Math.pow(size_interm2, 2) * z_scale, value: val_interm2.toFixed(nb_decimals)},
            {size: Math.pow(size_interm1, 2) * z_scale, value: val_interm1.toFixed(nb_decimals)},
            {size: size_min * z_scale, value: val_min.toFixed(nb_decimals)}
        ];

    var legend_elems = legend_root.selectAll('.legend')
                                  .append("g")
                                  .data(ref_symbols_params)
                                  .enter().insert('g')
                                  .attr('class', (d,i) => "legend_feature lg legend_" + i );

    let max_size = ref_symbols_params[0].size,
        last_size = 0,
        last_pos = y_pos2;
    if(nested == "false"){
        if(symbol_type === "circle"){
            legend_elems
                  .append("circle")
                  .styles({fill: color_symb_lgd, stroke: "rgb(0, 0, 0)", "fill-opacity": 1})
                  .attrs( (d, i) => {
                      last_pos = (i * boxgap) + d.size + last_pos + last_size;
                      last_size = d.size;
                      return {
                        "cx": xpos + space_elem + boxgap + max_size / 2,
                        "cy": last_pos,
                        "r": d.size
                      };
                    });

            last_pos = y_pos2; last_size = 0;
            legend_elems.append("text")
                .attrs( (d, i) => {
                  last_pos = (i * boxgap) + d.size + last_pos + last_size;
                  last_size = d.size;
                  return {
                    "x": xpos + space_elem + boxgap + max_size * 1.5 + 5,
                    "y": last_pos + (i * 2/3)
                  };
                })
                .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
                .text(d => d.value);
                // .attr("x", xpos + space_elem + boxgap + max_size * 1.5 + 5)
                // .attr("y", (d,i) => {
                //         last_pos = (i * boxgap) + d.size + last_pos + last_size;
                //         last_size = d.size;
                //         return last_pos + (i * 2/3);
                //         })


        } else if(symbol_type === "rect"){
            legend_elems
                  .append("rect")
                  .styles({fill: color_symb_lgd, stroke: "rgb(0, 0, 0)", "fill-opacity": 1})
                  .attrs( (d,i) => {
                    last_pos = (i * boxgap) + (d.size / 2) + last_pos + last_size;
                    last_size = d.size;
                    return {
                      "x": xpos + space_elem + boxgap + max_size / 2 - last_size / 2,
                      "y": last_pos,
                      "width": last_size,
                      "height": last_size
                    };
                  });
                  // .attr("x", d => xpos + space_elem + boxgap + max_size / 2 - d.size / 2)
                  // .attr("y", (d,i) => {
                  //       last_pos = (i * boxgap) + (d.size / 2) + last_pos + last_size;
                  //       last_size = d.size;
                  //       return last_pos;
                  //       })
                  // .attr('width', d => d.size)
                  // .attr('height', d => d.size)

            last_pos = y_pos2; last_size = 0;
            let x_text_pos = xpos + space_elem + boxgap + max_size * 1.5 + 5;
            legend_elems.append("text")
                .attr("x", x_text_pos)
                .attr("y", (d,i) => {
                        last_pos = (i * boxgap) + (d.size / 2) + last_pos + last_size;
                        last_size = d.size;
                        return last_pos + (d.size * 2 / 3);
                        })
                .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
                .text(d => d.value);
        }
    } else if (nested == "true"){
        if(symbol_type === "circle"){
            legend_elems
                  .append("circle")
                  .attrs(d => ({
                    cx: xpos + space_elem + boxgap + max_size / 2,
                    cy: ypos + 45 + max_size + (max_size / 2) - d.size,
                    r: d.size
                    }))
                  // .attr("cx", xpos + space_elem + boxgap + max_size / 2)
                  // .attr("cy", d => ypos + 45 + max_size + (max_size / 2) - d.size)
                  // .attr('r', d => d.size)
                  .styles({fill: color_symb_lgd, stroke: "rgb(0, 0, 0)", "fill-opacity": 1});
            last_pos = y_pos2; last_size = 0;
            legend_elems.append("text")
                .attr("x", xpos + space_elem + boxgap + max_size * 1.5 + 5)
                .attr("y", d => ypos + 45 + max_size * 2 - (max_size / 2) - d.size * 2)
                .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
                .text(d => d.value);
            last_pos = ypos + 30 + max_size + (max_size / 2);
        } else if(symbol_type === "rect"){
            legend_elems
                  .append("rect")
                  .attrs(d => ({
                      x: xpos + space_elem + boxgap,
                      y: ypos + 45 + max_size - d.size,
                      width: d.size, height: d.size}))
                  // .attr("x", xpos + space_elem + boxgap)
                  // .attr("y", d => ypos + 45 + max_size - d.size)
                  // .attr('height', d => d.size)
                  // .attr('width', d => d.size)
                  .styles({fill: color_symb_lgd, stroke: "rgb(0, 0, 0)", "fill-opacity": 1});
            last_pos = y_pos2; last_size = 0;
            legend_elems.append("text")
                .attr("x", xpos + space_elem + boxgap + max_size * 1.5 + 5)
                .attr("y", d => ypos + 45 + max_size - d.size)
                .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
                .text(d => d.value);
            last_pos = ypos + 30 + max_size + (max_size / 2);
        }
    }

    if(current_layers[layer].break_val != undefined){
        let bottom_colors  = legend_root.append("g").attr("class", "legend_feature");
        bottom_colors.insert("text").attr("id", "col1_txt")
                .attr("x", xpos + space_elem)
                .attr("y", last_pos + 1.75 * space_elem)
                .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
                .html('< ' + current_layers[layer].break_val);
        bottom_colors
                .insert("rect").attr("id", "col1")
                .attr("x", xpos + space_elem)
                .attr("y", last_pos + 2 * space_elem)
                .attrs({"width": space_elem, "height": space_elem})
                .style("fill", current_layers[layer].fill_color.two[0]);
        bottom_colors.insert("text").attr("id", "col1_txt")
                .attr("x", xpos + 3 * space_elem)
                .attr("y", last_pos + 1.75 * space_elem)
                .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
                .html('> ' + current_layers[layer].break_val);
        bottom_colors
                .insert("rect").attr("id", "col2")
                .attr("x", xpos + 3 * space_elem)
                .attr("y", last_pos + 2 * space_elem)
                .attrs({"width": space_elem, "height": space_elem})
                .style("fill", current_layers[layer].fill_color.two[1]);
    }
    var coef = current_layers[layer].break_val ? 3.75 : 2;
    legend_root.append("g").attr("class", "legend_feature")
            .insert("text").attr("id", "legend_bottom_note")
            .attrs({x:  xpos + space_elem, y: last_pos + coef * space_elem})
            .style("font", "11px 'Enriqueta', arial, serif")
            .html('');

    legend_root.call(drag_legend_func(legend_root));
    legend_root.attr("nested", nested);
    make_underlying_rect(legend_root, rect_under_legend, rect_fill_value);
    legend_root.select('#legendtitle').text(title || "");
    if(current_layers[layer].renderer == "PropSymbolsChoro"){
        legend_root.attr("transform", "translate(120, 0)")
    }
    make_legend_context_menu(legend_root, layer);
}

function createLegend_choro(layer, field, title, subtitle, boxgap = 0, rect_fill_value, rounding_precision, no_data_txt){
    var boxheight = 18,
        boxwidth = 18,
        xpos = 30,
        ypos = 30,
        last_pos = null,
        y_pos2 =  ypos + boxheight * 1.8,
        tmp_class_name = ["legend", "legend_feature", "lgdf_" + layer].join(' '),
        nb_class,
        data_colors_label;

    boxgap = +boxgap;

    var legend_root = map.insert('g')
                        .attrs({id: 'legend_root', class: tmp_class_name,
                                transform: 'translate(0,0)', 'boxgap': boxgap,
                                'rounding_precision': rounding_precision})
                        // .attr('id', 'legend_root')
                        // .attr("class", tmp_class_name)
                        // .attr("transform", "translate(0,0)")
                        // .attr("boxgap", boxgap)
                        // .attr("rounding_precision", rounding_precision)
                        .style("cursor", "grab");

    var rect_under_legend = legend_root.insert("rect");

    legend_root.insert('text').attr("id","legendtitle")
            .text(title || "Title").style("font", "bold 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + boxheight)
            .attr("y", ypos)
    legend_root.insert('text').attr("id","legendsubtitle")
            .text(subtitle).style("font", "italic 12px 'Enriqueta', arial, serif")
            .attr("x", xpos + boxheight)
            .attr("y", ypos + 15);

    if(current_layers[layer].renderer.indexOf('Categorical') > -1 || current_layers[layer].renderer.indexOf('PropSymbolsTypo') > -1){
        data_colors_label = [];
        current_layers[layer].color_map.forEach( (v,k) => {
            data_colors_label.push({value: v[1], color: v[0]}); } );
        nb_class = current_layers[layer].color_map.size;
    } else if(current_layers[layer].renderer.indexOf('TypoSymbols') > -1){
        data_colors_label = [];
        current_layers[layer].symbols_map.forEach( (v,k) => {
            data_colors_label.push({value: k, image: v}); } );
        nb_class = current_layers[layer].symbols_map.size;
    } else {
        data_colors_label = current_layers[layer].colors_breaks.map(obj => {
            return {value: obj[0], color: obj[1]};
        });
        nb_class = current_layers[layer].colors_breaks.length;
    }
    var legend_elems = legend_root.selectAll('.legend')
                                  .append("g")
                                  .data(data_colors_label)
                                  .enter().insert('g')
                                  .attr('class', function(d, i) { return "legend_feature lg legend_" + i; });

    if(current_layers[layer].renderer.indexOf('TypoSymbols') == -1)
        legend_elems
              .append('rect')
              .attr("x", xpos + boxwidth)
              .attr("y", (d, i) => {
                last_pos = y_pos2 + (i * boxgap) + (i * boxheight);
                return last_pos;
                })
              .attr('width', boxwidth)
              .attr('height', boxheight)
              .styles( d => ({
                "fill": d.color, "stroke": d.color
              }));

    else
        legend_elems
              .append('image')
              .attrs( (d, i) => ({
                  "x": xpos + boxwidth,
                  "y": y_pos2 + (i * boxgap) + (i * boxheight),
                  "width": boxwidth,
                  "height": boxheight,
                  "xlink:href": d.image[0]
                })
              );

    if(current_layers[layer].renderer.indexOf('Choropleth') > -1
          || current_layers[layer].renderer.indexOf('PropSymbolsChoro') > -1
          || current_layers[layer].renderer.indexOf('Gridded') > -1
          || current_layers[layer].renderer.indexOf('Stewart') > -1){
        let tmp_pos;
        legend_elems
          .append('text')
          .attr("x", xpos + boxwidth * 2 + 10)
          .attr("y", function(d, i){
            tmp_pos = y_pos2 + i * boxheight + (i * boxgap);
            return tmp_pos;
            })
          .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
          .text( d => round_value(+d.value.split(' - ')[1], rounding_precision) );

        legend_root
          .insert('text').attr("id", "lgd_choro_min_val")
          .attr("x", xpos + boxwidth * 2 + 10)
          .attr("y", tmp_pos + boxheight + boxgap)
          .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
          .text(d => round_value(data_colors_label[data_colors_label.length -1].value.split(' - ')[0], rounding_precision) );

    }
    else
        legend_elems
          .append('text')
          .attr("x", xpos + boxwidth * 2 + 10)
          .attr("y", (d, i) => y_pos2 + i * boxheight + (i * boxgap) + (boxheight * 2/3) )
          .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
          .text(d => d.value);

    if(current_layers[layer].options_disc && current_layers[layer].options_disc.no_data){
        let gp_no_data = legend_root.append("g");
        gp_no_data.attr("class", "legend_feature")
                .append('rect')
                .attrs({x:  xpos + boxheight, y: last_pos + 2 * boxheight})
                .attr('width', boxwidth)
                .attr('height', boxheight)
                .style('fill', current_layers[layer].options_disc.no_data)
                .style('stroke', current_layers[layer].options_disc.no_data);

        gp_no_data
          .append('text')
          .attrs({x: xpos + boxwidth * 2 + 10, y: last_pos + 2.7 * boxheight, id: "no_data_txt"})
          .styles({'alignment-baseline': 'middle' , 'font-size':'10px'})
          .text(no_data_txt != null ? no_data_txt : "No data");

        last_pos = last_pos + 2 * boxheight;
    }

    legend_root.append("g").attr("class", "legend_feature")
            .insert("text").attr("id", "legend_bottom_note")
            .attrs({x:  xpos + boxheight, y: last_pos + 2 * boxheight})
            .style("font", "11px 'Enriqueta', arial, serif")
            .text('');
    legend_root.call(drag_legend_func(legend_root));
    make_underlying_rect(legend_root, rect_under_legend, rect_fill_value);
    legend_root.select('#legendtitle').text(title || "");
    make_legend_context_menu(legend_root, layer);
}

// Todo : find a better organization for the options in this box
//       (+ better alignement)
function createlegendEditBox(legend_id, layer_name){
    function bind_selections(){
        box_class = [layer_name, "_legend_popup"].join('');
        legend_node = svg_map.querySelector(["#", legend_id, ".lgdf_", layer_name].join(''));
        title_content = legend_node.querySelector("#legendtitle");
        subtitle_content = legend_node.querySelector("#legendsubtitle");
        note_content = legend_node.querySelector("#legend_bottom_note");
        no_data_txt = legend_node.querySelector("#no_data_txt");
        legend_node_d3 = d3.select(legend_node);
        legend_boxes = legend_node_d3.selectAll(["#", legend_id, " .lg"].join('')).select("text");
    };

    var box_class, legend_node, title_content, subtitle_content, note_content, source_content;
    var legend_node_d3, legend_boxes, no_data_txt, rect_fill_value = {};

    bind_selections();
    if(document.querySelector("." + box_class)) document.querySelector("." + box_class).remove();
    let original_params = {
        title_content: title_content.textContent,
        subtitle_content: subtitle_content.textContent,
        note_content: note_content.textContent,
        no_data_txt: no_data_txt != null ? no_data_txt.textContent : null
        }; //, source_content: source_content.textContent ? source_content.textContent : ""


    if(legend_node.getAttribute("visible_rect") == "true"){
        rect_fill_value = {
            color: legend_node.querySelector("#under_rect").style.fill,
            opacity: legend_node.querySelector("#under_rect").style.fillOpacity
        }
    }

    make_confirm_dialog2(box_class, "Layer style options - " + layer_name, {widthFitContent: true})
        .then(function(confirmed){
            if(!confirmed){
                title_content.textContent = original_params.title_content;
                subtitle_content.textContent = original_params.subtitle_content;
                note_content.textContent = original_params.note_content;
                if(no_data_txt){
                    no_data_txt.textContent = original_params.no_data_txt;
                }
            }
            bind_selections();
            make_underlying_rect(legend_node_d3,
                                 legend_node_d3.select("#under_rect"),
                                 rect_fill_value);
        });

    var box_body = d3.select([".", box_class].join('')).select(".modal-body"),
        current_nb_dec;

    box_body.append('h3').html(i18next.t("app_page.legend_style_box.subtitle"));

    box_body.append('p').html(i18next.t("app_page.legend_style_box.lgd_title"))
            .append("img")
            .attrs({"id": "btn_info_text_annotation", "src": "/static/img/Information.png", "width": "17", "height": "17",  "alt": "Information",
                    class: "info_tooltip", "data-tooltip_info": i18next.t("app_page.legend_style_box.info_tooltip_line_break")})
            .styles({"cursor": "pointer", "vertical-align": "bottom"});

    box_body.insert('input')
            .attr("value", title_content.textContent)
            .on("keyup", function(){
                title_content.textContent = this.value;
            });

    box_body.append('p').html(i18next.t("app_page.legend_style_box.var_name"))
            .insert('input')
            .attr("value", subtitle_content.textContent)
            .on("keyup", function(){
                subtitle_content.textContent = this.value;
            });

    let tooltip_elem = document.querySelector("[data-tooltip_info]");
    new Tooltip(tooltip_elem, {
        dataAttr: "data-tooltip_info",
        animation: "slideNfade",
        duration: 50,
        delay: 100,
        container: document.getElementById("twbs")
    });

    if(legend_boxes._groups[0].length > 0 && current_layers[layer_name].renderer != "Categorical"
        && current_layers[layer_name].renderer != "TypoSymbols"){
        // Float precision for label in the legend
        // (actually it's not really the float precision but an estimation based on
        // the string representation of only two values but it will most likely do the job in many cases)
        let max_nb_decimals = 0,
            max_nb_left = 0;
        if(legend_id.indexOf("2") === -1 && legend_id.indexOf("links") === -1){
            max_nb_decimals = get_max_nb_dec(layer_name);
            max_nb_left = get_max_nb_left_sep(layer_name);
        } else {
            let nb_dec = [],
                nb_left = [];
            legend_boxes.each( d => {
                nb_dec.push(get_nb_decimals(d.value));
                nb_left.push(get_nb_left_separator(d.value));
            });
            max_nb_decimals = max_fast(nb_dec);
            max_nb_left = min_fast(nb_left);
        }
        max_nb_left = max_nb_left > 2 ? max_nb_left : 2;
        if(max_nb_decimals > 0){
            if(legend_node.getAttribute("rounding_precision"))
                current_nb_dec = legend_node.getAttribute("rounding_precision");
            else {
                let nbs = [],
                    nb_dec = [];
                legend_boxes.each(function(){ nbs.push(this.textContent); });
                for(let i=0; i < nbs.length; i++){
                    nb_dec.push(get_nb_decimals(nbs[i]));
                }
                current_nb_dec = max_fast(nb_dec);
            }
            if(max_nb_decimals > +current_nb_dec && max_nb_decimals > 18)
                max_nb_decimals = 18;
            box_body.append('p')
                        .style("display", "inline")
                        .attr("id", "precision_change_txt")
                        .html([i18next.t("app_page.legend_style_box.float_rounding"), current_nb_dec, ' '].join(''));
            if(legend_id === "legend_root")
                box_body.append('input')
                    .attrs({id: "precision_range", type: "range", min: -(+max_nb_left), max: max_nb_decimals, step: 1, value: current_nb_dec})
                    .styles({display: "inline", width: "90px", "vertical-align": "middle", "margin-left": "10px"})
                    .on('change', function(){
                        let nb_float = +this.value;
                        d3.select("#precision_change_txt")
                            .html([i18next.t("app_page.legend_style_box.float_rounding"), nb_float, ' '].join(''))
                        for(let i = 0; i < legend_boxes._groups[0].length; i++){
                            let values = legend_boxes._groups[0][i].__data__.value.split(' - ');
                            legend_boxes._groups[0][i].innerHTML = round_value(+values[1], nb_float);
                        }
                        let min_val = +legend_boxes._groups[0][legend_boxes._groups[0].length - 1].__data__.value.split(' - ')[0];
                        legend_node.querySelector('#lgd_choro_min_val').innerHTML = round_value(min_val, nb_float);
                        legend_node.setAttribute("rounding_precision", nb_float);
                    });
            else if(legend_id === "legend_root2")
                box_body.append('input')
                    .attrs({id: "precision_range", type: "range", min: -(+max_nb_left), max: max_nb_decimals, step: 1, value: current_nb_dec})
                    .styles({display: "inline", width: "90px", "vertical-align": "middle", "margin-left": "10px"})
                    .on('change', function(){
                        let nb_float = +this.value;
                        d3.select("#precision_change_txt")
                            .html([i18next.t("app_page.legend_style_box.float_rounding"), nb_float, ' '].join(''))
                        for(let i = 0; i < legend_boxes._groups[0].length; i++){
                            let value = legend_boxes._groups[0][i].__data__.value;
                            legend_boxes._groups[0][i].innerHTML = round_value(+value, nb_float);
                        }
                        legend_node.setAttribute("rounding_precision", nb_float);
                    });
            else if(legend_id === "legend_root_links")
                box_body.append('input')
                    .attrs({id: "precision_range", type: "range", min: -(+max_nb_left), max: max_nb_decimals, step: 1, value: current_nb_dec})
                    .styles({display: "inline", width: "90px", "vertical-align": "middle", "margin-left": "10px"})
                    .on('change', function(){
                        let nb_float = +this.value,
                            dec_mult = +["1", Array(nb_float).fill("0").join('')].join('');
                        d3.select("#precision_change_txt")
                            .html([i18next.t("app_page.legend_style_box.float_rounding"), nb_float, ' '].join(''))
                        for(let i = 0; i < legend_boxes._groups[0].length; i++){
                            let value = legend_boxes._groups[0][i].__data__.value[1];
                            legend_boxes._groups[0][i].innerHTML = round_value(+value, nb_float);
                        }
                        legend_node.setAttribute("rounding_precision", nb_float);
                        let min_val = +legend_boxes._groups[0][legend_boxes._groups[0].length - 1].__data__.value[0];
                        legend_node.querySelector('#lgd_choro_min_val').innerHTML = round_value(min_val, nb_float);
                        legend_node.setAttribute("rounding_precision", nb_float);
                    });
        }
    }

    if(legend_id === "legend_root"){
        let current_state = +legend_node.getAttribute("boxgap") == 0 ? true : false;
        let gap_section = box_body.insert("p");
        gap_section.append("input")
            .style('margin-left', '0px')
            .attrs({"type": "checkbox", id: 'style_lgd'})
            .on("change", function(){
                let rendered_field = current_layers[layer_name].rendered_field2 ? current_layers[layer_name].rendered_field2 :  current_layers[layer_name].rendered_field;
                legend_node = svg_map.querySelector(["#legend_root.lgdf_", layer_name].join(''));
                let boxgap = +legend_node.getAttribute("boxgap") == 0 ? 4 : 0;
                let rounding_precision = document.getElementById("precision_range") ? document.getElementById("precision_range").value : undefined;
                let transform_param = legend_node.getAttribute("transform"),
                    lgd_title = legend_node.querySelector("#legendtitle").innerHTML,
                    lgd_subtitle = legend_node.querySelector("#legendsubtitle").innerHTML;

                legend_node.remove();
                createLegend_choro(layer_name, rendered_field, lgd_title, lgd_subtitle, boxgap, rect_fill_value, rounding_precision);
                bind_selections();
                if(transform_param)
                    svg_map.querySelector(["#legend_root.lgdf_", layer_name].join('')).setAttribute("transform", transform_param);
            });
        gap_section.append('label')
            .attrs({'for': 'style_lgd', 'class': 'i18n', 'data-i18n': '[html]app_page.legend_style_box.gap_boxes'})
            .html(i18next.t('[html]app_page.legend_style_box.gap_boxes'));

        document.getElementById("style_lgd").checked = current_state;
    } else if (legend_id == "legend_root2"){
        let current_state = legend_node.getAttribute("nested") == "true" ? true : false;
        let gap_section = box_body.insert("p");
        gap_section.append("input")
                .style('margin-left', '0px')
                .attrs({id: 'style_lgd', type: 'checkbox'})
                .on("change", function(){
                    legend_node = svg_map.querySelector(["#legend_root2.lgdf_", layer_name].join(''))
                    let rendered_field = current_layers[layer_name].rendered_field;
                    let nested = legend_node.getAttribute("nested") == "true" ? "false" : "true";
                    let transform_param = legend_node.getAttribute("transform"),
                        lgd_title = legend_node.querySelector("#legendtitle").innerHTML,
                        lgd_subtitle = legend_node.querySelector("#legendsubtitle").innerHTML;

                    legend_node.remove();
                    createLegend_symbol(layer_name, rendered_field, lgd_title, lgd_subtitle, nested, rect_fill_value);
                    bind_selections();
                    if(transform_param)
                        svg_map.querySelector(["#legend_root2.lgdf_", layer_name].join('')).setAttribute("transform", transform_param);
                });
      gap_section.append('label')
          .attrs({'for': 'style_lgd', 'class': 'i18n', 'data-i18n' : '[html]app_page.legend_style_box.nested_symbols'})
          .html(i18next.t("[text]app_page.legend_style_box.nested_symbols"));
        document.getElementById("style_lgd").checked = current_state;
    }

// Todo : Reactivate this functionnality :
//    box_body.insert("p").html("Display features count ")
//            .insert("input").attr("type", "checkbox")
//            .on("change", function(){
//                alert("to be done!");
//            });

//    if(current_layers[layer].options_disc && current_layers[layer].options_disc.no_data){
    if(no_data_txt){
        box_body.insert('p').html(i18next.t("app_page.legend_style_box.no_data"))
                .insert('input').attr("value", no_data_txt.textContent)
                .style("font-family", "12px Gill Sans Extrabold, sans-serif")
                .on("keyup", function(){
                    no_data_txt.textContent = this.value;
                });
   }

    box_body.insert('p').html(i18next.t("app_page.legend_style_box.additionnal_notes"))
            .insert('input').attr("value", note_content.textContent)
            .style("font-family", "12px Gill Sans Extrabold, sans-serif")
            .on("keyup", function(){
                note_content.textContent = this.value;
            });

    let rectangle_options1 = box_body.insert('p');
    rectangle_options1.insert("input")
        .style('margin-left', '0px')
        .attrs({type: "checkbox",
                value: rect_fill_value.color || "#ededed",
                checked: rect_fill_value.color === undefined ? null : true,
                id: "rect_lgd_checkbox"})
        .on("change", function(){
            if(this.checked){
                rectangle_options2.style('display', "");
                rect_fill_value = {color: "#ffffff", opacity: 1};
            } else {
                rectangle_options2.style("display", "none");
                rect_fill_value = undefined;
            }
            make_underlying_rect(legend_node_d3,
                                 legend_node_d3.select("#under_rect"),
                                 rect_fill_value
                                 );
        });
    rectangle_options1.append('label')
        .attrs({for: "rect_lgd_checkbox", class: 'i18n', 'data-i18n': '[html]app_page.legend_style_box.under_rectangle'})
        .html(i18next.t("app_page.legend_style_box.under_rectangle"));

    let rectangle_options2 = box_body.insert('p').style('display', 'none');
    rectangle_options2.insert("input")
        .attrs({id: "choice_color_under_rect",
                type: "color",
                value: rect_fill_value ? rgb2hex(rect_fill_value.color) : undefined,
                disabled: rect_fill_value === undefined ? true : null})
        .on("change", function(){
            rect_fill_value = {color: this.value, opacity: 1};
            make_underlying_rect(legend_node_d3,
                                 legend_node_d3.select("#under_rect"),
                                 rect_fill_value
                                 );
        });
}

function move_legends(){
    let legends = [
        svg_map.querySelectorAll("#legend_root"),
        svg_map.querySelectorAll("#legend_root2"),
        svg_map.querySelectorAll("#legend_root_links"),
        svg_map.querySelectorAll('#scale_bar.legend')
        ];

    let xy0_map = get_map_xy0(),
        dim_width = w + xy0_map.x,
        dim_heght = h + xy0_map.y;

    for(let j=0; j < 4; ++j){
        let legends_type = legends[j];
        for(let i=0, i_len = legends_type.length; i < i_len; ++i){
            let legend_bbox = legends_type[i].getBoundingClientRect();
            if((legend_bbox.x + legend_bbox.width) > dim_width){
                let current_transform = legends_type[i].getAttribute("transform");
                let [val_x, val_y] = /\(([^\)]+)\)/.exec(current_transform)[1].split(",");
                let trans_x = legend_bbox.x + legend_bbox.width - dim_width;
                legends_type[i].setAttribute("transform",
                    ["translate(", [+val_x - trans_x, val_y], ")"].join(''));
            }
            if((legend_bbox.y + legend_bbox.height) > dim_heght){
                let current_transform = legends_type[i].getAttribute("transform");
                let [val_x, val_y] = /\(([^\)]+)\)/.exec(current_transform)[1].split(",");
                let trans_y = legend_bbox.y +legend_bbox.height - dim_heght;
                legends_type[i].setAttribute("transform",
                    ["translate(", [val_x, +val_y - trans_y], ")"].join(''));
            }
        }
    }
}


var get_max_nb_dec = function(layer_name){
    if(!(current_layers[layer_name]) || !(current_layers[layer_name].colors_breaks))
        return;
    let max = 0;
    current_layers[layer_name].colors_breaks.forEach( el => {
        let tmp = el[0].split(' - ');
        let p1 = tmp[0].indexOf("."), p2 = tmp[1].indexOf(".");
        if(p1 > -1)
            if(tmp[0].length - 1 - p1 > max)
                max = tmp[0].length - 1 - tmp[0].indexOf('.');
        if(p2 > -1)
            if(tmp[1].length - 1 - p2 > max)
                max = tmp[1].length - 1 - tmp[1].indexOf('.');
        });
    return max;
}

var get_max_nb_left_sep = function(layer_name){
    if(!(current_layers[layer_name]) || !(current_layers[layer_name].colors_breaks))
        return;
    let nb_left = [];
    current_layers[layer_name].colors_breaks.forEach( el => {
        let tmp = el[0].split(' - ');
        let p1 = tmp[0].indexOf("."), p2 = tmp[1].indexOf(".");
        nb_left.push(p1);
        nb_left.push(p2);
        });
    return min_fast(nb_left);
}
