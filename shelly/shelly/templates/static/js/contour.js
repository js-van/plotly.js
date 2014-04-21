(function() {
var contour = window.Plotly.Contour = {};

// contour maps use heatmap.calc but have their own plot function

contour.plot = function(gd,plotinfo,cd) {
    Plotly.Lib.markTime('in Contour.plot');
    var t = cd[0].t,
        i = t.curve,
        xa = plotinfo.x,
        ya = plotinfo.y,
        gl = gd.layout;

    var id='contour'+i; // contour group id
    var cb_id='cb'+i; // colorbar id

    var contours = [], pathinfo = [],
        cs = t.contoursize||1;
    for(var ci=t.contourstart; ci<t.contourend+cs/10; ci+=cs) {
        contours.push(ci);
        pathinfo.push({level:ci,
            crossings:{}, // all the cells with nontrivial marching index
            starts:[], // starting points on the edges of the lattice for each contour
            edgepaths:[], // all unclosed paths (may have less items than starts, if a path is closed by rounding)
            paths:[] // all closed paths
        });
    }
    t.numcontours = pathinfo.length;

    if(t.coloring=='heatmap') { // use a heatmap to fill - draw it behind the lines
        t.zsmooth = 'best';
        if(t.zauto && t.autocontour===false) {
            t.zmin = t.contourstart-t.contoursize/2;
            t.zmax = t.zmin+t.numcontours*t.contoursize;
        }
        Plotly.Heatmap.plot(gd,plotinfo,cd);
    }
    else {
        gl._paper.selectAll('.hm'+i).remove(); // in case this used to be a heatmap (or have heatmap fill)
    }

    if(t.coloring!='fill') { t.showlines = true; }

    if(t.visible===false) {
        gl._paper.selectAll('.'+id).remove();
        gl._paper.selectAll('.'+cb_id).remove();
        return;
    }

    var z=cd[0].z, x=cd[0].x, y=cd[0].y;
    // get z dims
    var m=z.length, n=Plotly.Lib.aggNums(Math.max,null,z.map(function(row) { return row.length; })); // num rows, cols

    // find all the contours at once
    // since we want to be exhaustive we'll check for contour crossings at every intersection
    // using a modified marching squares algorithm, so we disambiguate the saddle points from the start
    // and we ignore the cases with no crossings
    // the index I'm using is based on http://en.wikipedia.org/wiki/Marching_squares
    // except that the saddles bifurcate
    function getMarchingIndex(val,corners) {
        var mi = (corners[0][0]>val ? 0:1) +
                 (corners[0][1]>val ? 0:2) +
                 (corners[1][1]>val ? 0:4) +
                 (corners[1][0]>val ? 0:8);
        if(mi==5||mi==10) {
            var avg = (corners[0][0]+corners[0][1]+corners[1][0]+corners[1][1])/4;
            if(val>avg) {
                // two peaks with a big valley
                if(mi==5) { return 713; } // ie conceptually a combo of 7 and 13
                return 1114; // ie conceptually combo of 11 and 14
            }
            else {
                // two valleys with a big ridge
                if(mi==5) { return 104; } // ie conceptually combo of 1 and 4
                return 208; // ie conceptually a combo of 2 and 8
            }
        }
        else if(mi==15) { return 0; }
        return mi;
    }
    var xi,yi,ystartindices,startIndices,label,corners,cmin,cmax,mi,nc;
    var bottomStart = [1,9,13,104,713],
        topStart = [4,6,7,104,713],
        leftStart = [8,12,14,208,1114],
        rightStart = [2,3,11,208,1114],

        newDelta = [ // which way [dx,dy] do we leave a given index? saddles are already disambiguated
            null,[-1,0],[0,-1],[-1,0],
            [1,0],null,[0,-1],[-1,0],
            [0,1],[0,1],null,[0,1],
            [1,0],[1,0],[0,-1]
        ],
        chooseSaddle = { // for each saddle, the first index here is used for dx||dy<0, the second for dx||dy>0
            104:[4, 1],
            208:[2, 8],
            713:[7, 13],
            1114:[11, 14]
        },
        // after one index has been used for a saddle, which to we substitute to be used up later?
        saddleRemainder = {1:4, 2:8, 4:1, 7:13, 8:2, 11:14, 13:7, 14:11};

    function makeCrossings(pi) {
        mi = getMarchingIndex(pi.level,corners);
        if(mi) {
            pi.crossings[label] = mi;
            if(startIndices.indexOf(mi)!=-1) { pi.starts.push(label.split(',').map(Number)); }
        }
    }

    // for heatmaps we leave empty values in place, but for contours we should provide a value
    // TODO: for the moment we just set them to the min value, but it would be cool to use
    // interpolated / extrapolated values (although exactly how to do this is a little unclear in 2D)
    function zclean(xi,yi) { var v = z[yi][xi]; if($.isNumeric(v)) { return v; } return t.zmin;}

    for(yi = 0; yi<m-1; yi++) {
        if(yi===0) { ystartIndices = bottomStart; }
        else if(yi==m-2) { ystartIndices = topStart; }
        else { ystartIndices = []; }

        for(xi = 0; xi<n-1; xi++) {
            if(xi===0) { startIndices = ystartIndices.concat(leftStart); }
            else if(xi==n-2) { startIndices = ystartIndices.concat(rightStart); }
            else { startIndices = ystartIndices; }

            label = xi+','+yi;
            corners = [[zclean(xi,yi),zclean(xi+1,yi)],[zclean(xi,yi+1),zclean(xi+1,yi+1)]];//[[z[yi][xi],z[yi][xi+1]],[z[yi+1][xi],z[yi+1][xi+1]]];
            cmax = Plotly.Lib.findBin(Plotly.Lib.aggNums(Math.max,null,corners),contours,true);
            cmin = Plotly.Lib.findBin(Plotly.Lib.aggNums(Math.min,null,corners),contours,true);

            pathinfo.forEach(makeCrossings);
        }
    }

    // now calculate the paths

    function getHInterp(level,locx,locy) {
        var dx = (level-zclean(locx,locy))/(zclean(locx+1,locy)-zclean(locx,locy));
        return [xa.c2p((1-dx)*x[locx] + dx*x[locx+1]), ya.c2p(y[locy])];
    }

    function getVInterp(level,locx,locy) {
        var dy = (level-zclean(locx,locy))/(zclean(locx,locy+1)-zclean(locx,locy));
        return [xa.c2p(x[locx]), ya.c2p((1-dy)*y[locy] + dy*y[locy+1])];
    }

    function equalpts(pt1,pt2) {
        return Math.abs(pt1[0]-pt2[0])<0.01 && Math.abs(pt1[1]-pt2[1])<0.01;
    }

    function ptdist(p1,p2) {
        var dx = p1[0]-p2[0],
            dy = p1[1]-p2[1];
        return Math.sqrt(dx*dx+dy*dy);
    }


    function makePath(nc,st,edgeflag) {
        var pi = pathinfo[nc],
            loc = st.split(',').map(Number),
            mi = pi.crossings[st],
            level = pi.level,
            loclist = [];

        // find the interpolated starting point
        var interp_f,
            dx=0, // dx, dy are the index step we took to get where we are at the beginning of the loop
            dy=0;
        if(mi>20 && edgeflag) {
            if(mi==208 || mi==1114) { // these saddles start at +/- x
                interp_f = getVInterp;
                dx = loc[0]===0 ? 1 : -1; // if we're starting at the left side, we must be going right
            }
            else {
                interp_f = getHInterp;
                dy = loc[1]===0 ? 1 : -1; // if we're starting at the bottom, we must be going up
            }
        }
        else if(bottomStart.indexOf(mi)!=-1) { interp_f = getHInterp; dy = 1; }
        else if(leftStart.indexOf(mi)!=-1) { interp_f = getVInterp; dx = 1; }
        else if(topStart.indexOf(mi)!=-1) { interp_f = getHInterp; dy = -1; }
        else { interp_f = getVInterp; dx = -1; }
        // start by going backward a half step and finding the crossing point
        var pts = [interp_f(level,loc[0]+Math.max(-dx,0),loc[1]+Math.max(-dy,0))],
            startDelta = dx+','+dy;

        // now follow the path
        var miTaken, locstr = loc.join(',');
        for(var cnt=0; cnt<10000; cnt++) { // just to avoid infinite loops
            loclist.push(locstr);
            if(mi>20) {
                miTaken = chooseSaddle[mi][(dx||dy)<0?0:1];
                pi.crossings[locstr] = saddleRemainder[miTaken];
            }
            else {
                miTaken = mi;
                delete pi.crossings[locstr];
            }
            // miTaken = mi>20 ? chooseSaddle[mi][(dx||dy)<0?0:1] : mi;
            // if(miTaken==mi) { delete pi.crossings[locstr];}
            // else { pi.crossings[locstr] = saddleRemainder[miTaken]; }
            if(!newDelta[miTaken]) {
                console.log('found bad marching index',mi,miTaken,loc,nc);
                break;
            }
            dx = newDelta[miTaken][0];
            dy = newDelta[miTaken][1];
            // find the crossing a half step forward, and then take the full step
            if(dx) {
                pts.push(getVInterp(level,loc[0]+Math.max(dx,0),loc[1]));
                loc[0]+=dx;
            }
            else {
                pts.push(getHInterp(level,loc[0],loc[1]+Math.max(dy,0)));
                loc[1]+=dy;
            }
            // don't include the same point multiple times
            if(equalpts(pts[pts.length-1],pts[pts.length-2])) {
                pts.pop();
            }
            locstr = loc.join(',');
            if((locstr==st && dx+','+dy==startDelta) || (edgeflag && ((dx&&(loc[0]<0||loc[0]>n-2)) || (dy&&(loc[1]<0||loc[1]>m-2))))) {
                break;
            }
            mi = pi.crossings[locstr];
        }
        if(cnt==10000) { console.log('Infinite loop in contour?'); }
        var closedpath = equalpts(pts[0],pts[pts.length-1]);

        // check for points that are too close together (<1/5 the average dist, less if less smoothed) and just take the center (or avg of center 2)
        // this cuts down on funny behavior when a point is very close to a contour level
        var totaldist=0,
            thisdist,
            alldists=[],
            dist_threshold_factor=0.2*t.ls;
        for(cnt=1; cnt<pts.length; cnt++) {
            thisdist = ptdist(pts[cnt],pts[cnt-1]);
            totaldist += thisdist;
            alldists.push(thisdist);
        }

        var dist_threshold = totaldist/alldists.length*dist_threshold_factor,
            distgroup,cnt2,cnt3,cropstart=0,newpt,ptcnt,ptavg;
        function getpt(i) { return pts[i%pts.length]; }

        for(cnt=pts.length-2; cnt>=cropstart; cnt--) {
            distgroup = alldists[cnt];
            if(distgroup<dist_threshold) {
                cnt3 = 0;
                for(cnt2=cnt-1; cnt2>=cropstart; cnt2--) {
                    if(distgroup+alldists[cnt2]<dist_threshold) { distgroup += alldists[cnt2]; }
                    else { break; }
                }
                // closed path with close points wrapping around the boundary?
                if(closedpath && cnt==pts.length-2) {
                    for(cnt3=0; cnt3<cnt2; cnt3++) {
                        if(distgroup+alldists[cnt3]<dist_threshold) { distgroup += alldists[cnt3]; }
                        else { break; }
                    }
                }
                ptcnt = cnt-cnt2+cnt3+1;
                ptavg = Math.floor((cnt+cnt2+cnt3+2)/2);

                // either endpoint included: keep the endpoint
                if(!closedpath && cnt==pts.length-2) { newpt = pts[pts.length-1]; }
                else if(!closedpath && cnt2==-1) { newpt = pts[0]; }
                // odd # of points - just take the central one
                else if(ptcnt%2) { newpt = getpt(ptavg); }
                // even # of pts - average central two
                else  { newpt = [(getpt(ptavg)[0]+getpt(ptavg+1)[0])/2, (getpt(ptavg)[1]+getpt(ptavg+1)[1])/2]; }

                pts.splice(cnt2+1,cnt-cnt2+1,newpt);
                cnt = cnt2+1;
                if(cnt3) { cropstart = cnt3; }
                if(closedpath) {
                    if(cnt==pts.length-2) { pts[cnt3] = pts[pts.length-1]; }
                    else if(cnt===0) { pts[pts.length-1] = pts[0]; }
                }
            }
        }
        pts.splice(0,cropstart);

        // don't return single-point paths (ie all points were the same so they got deleted?)
        if(pts.length<2) { return; }
        else if(closedpath) {
            pts.pop();
            pi.paths.push(pts);
        }
        else {
            if(!edgeflag) { console.log('unclosed interior contour?',nc,st,loclist,pts.join('L')); }

            // edge path - does it start where an existing edge path ends, or vice versa?
            var merged = false;
            pi.edgepaths.forEach(function(edgepath,edgei) {
                if(!merged && equalpts(edgepath[0],pts[pts.length-1])) {
                    pts.pop();
                    merged = true;
                    // now does it ALSO meet the end of another (or the same) path?
                    var doublemerged = false;
                    pi.edgepaths.forEach(function(edgepath2,edgei2) {
                        if(!doublemerged && equalpts(edgepath2[edgepath2.length-1],pts[0])) {
                            doublemerged = true;
                            pts.splice(0,1);
                            pi.edgepaths.splice(edgei,1);
                            if(edgei2==edgei) { pi.paths.push(pts.concat(edgepath2)); } // the path is now closed
                            else { pi.edgepaths[edgei2] = pi.edgepaths[edgei2].concat(pts,edgepath2); }
                        }
                    });
                    if(!doublemerged) { pi.edgepaths[edgei] = pts.concat(edgepath); }
                }
            });
            pi.edgepaths.forEach(function(edgepath,edgei) {
                if(!merged && equalpts(edgepath[edgepath.length-1],pts[0])) {
                    pts.splice(0,1);
                    pi.edgepaths[edgei] = edgepath.concat(pts);
                    merged = true;
                }
            });

            if(!merged) { pi.edgepaths.push(pts); }
        }
    }

    // console.log(contours,µ.util.deepExtend([],pathinfo));

    pathinfo.forEach(function(pi,nc){
        // console.log('starts',nc,pi.starts,µ.util.deepExtend({},pi.crossings));
        pi.starts.forEach(function(st){ makePath(nc,String(st),'edge'); });
        var cnt=0;
        // console.log('done starts',nc,µ.util.deepExtend([],pi.paths));
        while(Object.keys(pi.crossings).length && cnt<10000) {
            cnt++;
            makePath(nc,Object.keys(pi.crossings)[0]);
        }
        if(cnt==10000) { console.log('Infinite loop in contour?'); }
        // console.log('done paths',nc,µ.util.deepExtend([],pi.paths));
    });

    // console.log(µ.util.deepExtend([],pathinfo));

    // and draw everything
    var plotgroup = plotinfo.plot.selectAll('g.contour.'+id).data(cd);
    plotgroup.enter().append('g').classed('contour',true).classed(id,true);
    plotgroup.exit().remove();

    var leftedge = xa.c2p(x[0]),
        rightedge = xa.c2p(x[x.length-1]),
        bottomedge = ya.c2p(y[0]),
        topedge = ya.c2p(y[y.length-1]),
        perimeter = [[leftedge,topedge],[rightedge,topedge],[rightedge,bottomedge],[leftedge,bottomedge]];

    function istop(pt) { return Math.abs(pt[1]-topedge)<0.01; }
    function isbottom(pt) { return Math.abs(pt[1]-bottomedge)<0.01; }
    function isleft(pt) { return Math.abs(pt[0]-leftedge)<0.01; }
    function isright(pt) { return Math.abs(pt[0]-rightedge)<0.01; }

    var bggroup = plotgroup.selectAll('g.contourbg').data([0]);
    bggroup.enter().append('g').classed('contourbg',true);
    var bgfill = bggroup.selectAll('path').data(t.coloring=='fill' ? [0] : []);
    bgfill.enter().append('path');
    bgfill.exit().remove();
    bgfill
        .attr('d','M'+perimeter.join('L')+'Z')
        .style('stroke','none');

    var fillgroup = plotgroup.selectAll('g.contourfill').data([0]);
    fillgroup.enter().append('g').classed('contourfill',true);
    var fillitems = fillgroup.selectAll('path').data(t.coloring=='fill' ? pathinfo : []);
    fillitems.enter().append('path');
    fillitems.exit().remove();
    fillitems.each(function(d,nc){
        // join all paths for this level together into a single path
        // first follow clockwise around the perimeter to close any open paths
        // if the whole perimeter is above this level, start with a path
        // enclosing the whole thing. With all that, the parity should mean
        // that we always fill everything above the contour, nothing below
        var fullpath = (d.edgepaths.length || zclean(0,0)<d.level) ? '' : ('M'+perimeter.join('L')+'Z');
        var i=0,
            startsleft = d.edgepaths.map(function(v,i){ return i; }),
            endpt, newendpt, cnt, nexti, newloop = true, addpath;
        while(startsleft.length) {
            addpath = Plotly.Drawing.smoothopen(d.edgepaths[i],t.ls);
            fullpath += newloop ? addpath : addpath.replace(/^M/,'L');
            startsleft.splice(startsleft.indexOf(i),1);
            endpt = d.edgepaths[i][d.edgepaths[i].length-1];
            cnt=0;
            //now loop through sides, moving our endpoint until we find a new start
            for(cnt=0; cnt<4; cnt++) { // just to prevent infinite loops
                if(!endpt) { console.log('missing end?',i,d); break; }

                if(istop(endpt) && !isright(endpt)) { newendpt = [rightedge,topedge]; }
                else if(isleft(endpt)) { newendpt = [leftedge,topedge]; }
                else if(isbottom(endpt)) { newendpt = [leftedge,bottomedge]; }
                else if(isright(endpt)) { newendpt = [rightedge,bottomedge]; }

                for(nexti=0; nexti<d.edgepaths.length; nexti++) {
                    var ptNew = d.edgepaths[nexti][0];
                    // is ptNew on the (horz. or vert.) segment from endpt to newendpt?
                    if(Math.abs(endpt[0]-newendpt[0])<0.01) {
                        if(Math.abs(endpt[0]-ptNew[0])<0.01 && (ptNew[1]-endpt[1])*(newendpt[1]-ptNew[1])>=0) {
                            newendpt = ptNew;
                            break;
                        }
                    }
                    else if(Math.abs(endpt[1]-newendpt[1])<0.01) {
                        if(Math.abs(endpt[1]-ptNew[1])<0.01 && (ptNew[0]-endpt[0])*(newendpt[0]-ptNew[0])>=0) {
                            newendpt = ptNew;
                            break;
                        }
                    }
                    else {
                        console.log('endpt to newendpt is not vert. or horz.',endpt,newendpt,ptNew);
                    }
                }

                endpt = newendpt;

                if(nexti<d.edgepaths.length) { break; }
                fullpath += 'L'+newendpt;
            }

            if(nexti==d.edgepaths.length) { console.log('unclosed perimeter path'); break; }

            i = nexti;

            // if we closed back on a loop we already included, close it and start a new loop
            newloop = (startsleft.indexOf(i)==-1);
            if(newloop) {
                i = startsleft[0];
                fullpath += 'Z';
            }
        }

        // finally add the interior paths
        d.paths.forEach(function(path) { fullpath += Plotly.Drawing.smoothclosed(path,t.ls); });

        if(!fullpath) { d3.select(this).remove(); }
        else { d3.select(this).attr('d',fullpath).style('stroke','none'); }
    });

    var linegroup = plotgroup.selectAll('g.contourlevel').data(t.showlines ? pathinfo : []);
    linegroup.enter().append('g').classed('contourlevel',true);
    linegroup.exit().remove();

    var opencontourlines = linegroup.selectAll('path.openline')
        .data(function(d){ return d.edgepaths; });
    opencontourlines.enter().append('path').classed('openline',true);
    opencontourlines.exit().remove();
    opencontourlines
        .attr('d', function(d){ return Plotly.Drawing.smoothopen(d,t.ls); })
        .style('stroke-miterlimit',1);

    var closedcontourlines = linegroup.selectAll('path.closedline')
        .data(function(d){ return d.paths; });
    closedcontourlines.enter().append('path').classed('closedline',true);
    closedcontourlines.exit().remove();
    closedcontourlines
        .attr('d', function(d){ return Plotly.Drawing.smoothclosed(d,t.ls); })
        .style('stroke-miterlimit',1);

    Plotly.Lib.markTime('done Contour.plot');
};

contour.style = function(s) {
    s.style('opacity',function(d){ return d.t.op; })
    .each(function(d) {
        var c = d3.select(this),
            t = d.t,
            cs = t.contoursize||1,
            nc = Math.floor((t.contourend+cs/10-t.contourstart)/cs)+1,
            scl = Plotly.Plots.getScale(t.scl),
            extraLevel = t.coloring=='lines' ? 0 : 1,
            colormap = d3.scale.linear()
                .domain(scl.map(function(si){
                    return (si[0]*(nc+extraLevel-1)-(extraLevel/2))*cs+t.contourstart;
                }))
                .interpolate(d3.interpolateRgb)
                .range(scl.map(function(si){ return si[1]; }));

        c.selectAll('g.contourlevel').each(function(d,i) {
            var lc = t.coloring=='lines' ? colormap(t.contourstart+i*cs): t.lc;
            d3.select(this).selectAll('path')
                .call(Plotly.Drawing.lineGroupStyle,t.lw, lc, t.ld);
        });
        c.selectAll('g.contourbg path')
            .style('fill',colormap(t.contourstart-cs/2));
        c.selectAll('g.contourfill path')
            .style('fill',function(d,i){ return colormap(t.contourstart+(i+0.5)*cs); });
    });
};

contour.colorbar = function(gd,cd) {
    var t = cd[0].t,
        cb_id = 'cb'+t.curve;

    gd.layout._infolayer.selectAll('.'+cb_id).remove();
    if(t.showscale===false){
        Plotly.Plots.autoMargin(gd,t.curve);
    }
    else {
        // instantiate the colorbar (will be drawn and styled in contour.style)
        var cb = Plotly.Colorbar(gd,cb_id);

        var cs = t.contoursize||1,
            nc = Math.floor((t.contourend+cs/10-t.contourstart)/cs)+1,
            scl = Plotly.Plots.getScale(t.scl),
            extraLevel = t.coloring=='lines' ? 0 : 1,
            colormap = d3.scale.linear().interpolate(d3.interpolateRgb),
            colorDomain = scl.map(function(si){
                    return (si[0]*(nc+extraLevel-1)-(extraLevel/2))*cs+t.contourstart;
                }),
            colorRange = scl.map(function(si){ return si[1]; });

        // colorbar fill and lines
        if(t.coloring=='heatmap') {
            if(t.zauto && t.autocontour===false) {
                t.zmin = t.contourstart-cs/2;
                t.zmax = t.zmin+nc*cs;
            }
            cb.filllevels({start:t.zmin, end:t.zmax, size:(t.zmax-t.zmin)/254});
            colorDomain = scl.map(function(si){ return si[0]*(t.zmax-t.zmin)+t.zmin; });

            // do the contours extend beyond the colorscale? if so, extend the colorscale with constants
            var zRange = d3.extent([t.zmin, t.zmax, t.contourstart, t.contourstart+cs*(nc-1)]),
                zmin = zRange[t.zmin<t.zmax ? 0 : 1],
                zmax = zRange[t.zmin<t.zmax ? 1 : 0];
            if(zmin!=t.zmin) {
                colorDomain.splice(0,0,zmin);
                colorRange.splice(0,0,colorRange[0]);
            }
            if(zmax!=t.zmax) {
                colorDomain.push(zmax);
                colorRange.push(colorRange[colorRange.length-1]);
            }
        }

        colormap.domain(colorDomain).range(colorRange);

        cb.options({
            fillcolor: t.coloring=='fill' || t.coloring=='heatmap' ? colormap : '',
            line:{
                color: t.coloring=='lines' ? colormap : t.lc,
                width: t.showlines ? t.lw : 0,
                dash: t.ld
            },
            levels: {start:t.contourstart, end:t.contourend, size:cs}
        });

        // all the other colorbar styling - any calcdata attribute that starts cb_
        // apply these options, and draw the colorbar
        cb.cdoptions(t)();
    }
};

contour.defaults = function() {
    return [
        {dataAttr:'autocontour', cdAttr:'autocontour', dflt:true},
        {dataAttr:'ncontours', cdAttr:'ncontours', dflt:0},
        {dataAttr:'contours.start', cdAttr:'contourstart', dflt:0},
        {dataAttr:'contours.end', cdAttr:'contourend', dflt:1},
        {dataAttr:'contours.size', cdAttr:'contoursize', dflt:1},
        {dataAttr:'contours.coloring', cdAttr:'coloring', dflt:'fill'},
        {dataAttr:'contours.showlines', cdAttr:'showlines', dflt:true},
        {dataAttr:'line.color', cdAttr:'lc', dflt:'#000'},
        {dataAttr:'line.width', cdAttr:'lw', dflt:0.5},
        {dataAttr:'line.dash', cdAttr:'ld', dflt:'solid'},
        {dataAttr:'line.smoothing', cdAttr:'ls', dflt:1}
    ];
};

}()); // end Contour object definition