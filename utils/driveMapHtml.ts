/**
 * The map on the drive screen (shown when a destination is set): a small web
 * page with a dark vector map (MapLibre + OpenFreeMap, no key needed) that
 * runs in a WebView in the apps and in an iframe on the web. The app sends it
 * the route parts, the car's position and the chargers as one JSON object via
 * window.__driveMap(data).
 */

export interface DriveMapData {
  /** [lon, lat] lists, drawn green / amber / dotted red */
  ok: [number, number][];
  reserve: [number, number][];
  out: [number, number][];
  /** [lon, lat] */
  pos: [number, number] | null;
  dest: [number, number] | null;
  chargers: { lon: number; lat: number; label: string }[];
  /** label at the point where the reserve starts, e.g. "10% reserve" */
  reserveLabel: string | null;
}

export const DRIVE_MAP_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css">
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#14181c;overflow:hidden}
.car{width:26px;height:26px}
.dest{width:18px;height:18px;border-radius:50%;background:#F2F5F7;border:5px solid #0B0E11;box-shadow:0 0 0 2px #F2F5F7;box-sizing:border-box}
.chip{font:500 12px -apple-system,Roboto,sans-serif;color:#F2F5F7;background:#12161B;border:1px solid #2A323A;border-radius:10px;padding:3px 8px;white-space:nowrap}
.chip b{color:#34D17A;font-weight:500}
.res{font:500 12px -apple-system,Roboto,sans-serif;color:#F59E0B;background:#2E2108;border-radius:10px;padding:3px 8px;white-space:nowrap}
#msg{position:absolute;left:0;right:0;top:45%;text-align:center;font:14px -apple-system,Roboto,sans-serif;color:#8B95A1}
#fit{position:absolute;right:10px;bottom:34px;width:38px;height:38px;border-radius:19px;background:#12161B;border:1px solid #2A323A;display:none;align-items:center;justify-content:center}
.maplibregl-ctrl-attrib{background:rgba(11,14,17,.6)!important;color:#5C6670}
.maplibregl-ctrl-attrib a{color:#8B95A1!important}
</style></head><body>
<div id="map"></div><div id="msg">Loading map…</div>
<div id="fit"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F2F5F7" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></div>
<script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
<script>
(function(){
  var data=null, ready=false, moved=false, map=null, carM=null, destM=null, resM=null, chips=[];
  var msg=document.getElementById('msg'), fitBtn=document.getElementById('fit');
  function line(c){return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:c&&c.length>1?c:[]}};}
  function bearing(a,b){var r=Math.PI/180,y=Math.sin((b[0]-a[0])*r)*Math.cos(b[1]*r),x=Math.cos(a[1]*r)*Math.sin(b[1]*r)-Math.sin(a[1]*r)*Math.cos(b[1]*r)*Math.cos((b[0]-a[0])*r);return Math.atan2(y,x)/r;}
  function el(cls,html){var d=document.createElement('div');d.className=cls;if(html)d.innerHTML=html;return d;}
  function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function fit(animate){
    if(!map||!data)return;
    var pts=[].concat(data.ok||[],data.reserve||[],data.out||[]);
    if(data.pos)pts.push(data.pos); if(data.dest)pts.push(data.dest);
    if(pts.length<2)return;
    var b=new maplibregl.LngLatBounds(pts[0],pts[0]);
    for(var i=1;i<pts.length;i++)b.extend(pts[i]);
    map.fitBounds(b,{padding:{top:30,bottom:34,left:108,right:40},duration:animate?600:0,maxZoom:15});
  }
  function draw(){
    if(!ready||!data)return;
    map.getSource('ok').setData(line(data.ok));
    map.getSource('reserve').setData(line(data.reserve));
    map.getSource('out').setData(line(data.out));
    if(data.pos){
      var next=(data.ok&&data.ok[1])||(data.reserve&&data.reserve[1])||(data.out&&data.out[1])||null;
      if(!carM){carM=new maplibregl.Marker({element:el('car','<svg viewBox="0 0 26 26" width="26" height="26"><path d="M13 2 L23 23 L13 18 L3 23 Z" fill="#34D17A" stroke="#0B0E11" stroke-width="2" stroke-linejoin="round"/></svg>'),rotationAlignment:'map'}).setLngLat(data.pos).addTo(map);}
      carM.setLngLat(data.pos); if(next)carM.setRotation(bearing(data.pos,next));
    }
    if(data.dest){ if(!destM)destM=new maplibregl.Marker({element:el('dest')}).setLngLat(data.dest).addTo(map); destM.setLngLat(data.dest); }
    var edge=data.reserveLabel&&data.reserve&&data.reserve.length>1?data.reserve[0]:null;
    if(edge){ if(!resM)resM=new maplibregl.Marker({element:el('res'),anchor:'left',offset:[10,0]}).setLngLat(edge).addTo(map); resM.setLngLat(edge); resM.getElement().textContent=data.reserveLabel; }
    else if(resM){resM.remove();resM=null;}
    for(var i=0;i<chips.length;i++)chips[i].remove(); chips=[];
    (data.chargers||[]).forEach(function(c){
      chips.push(new maplibregl.Marker({element:el('chip','<b>⚡</b> '+esc(c.label)),anchor:'bottom',offset:[0,-6]}).setLngLat([c.lon,c.lat]).addTo(map));
    });
    if(!moved)fit(false);
    declutter();
  }
  // labels that would sit on top of each other (or under the dial) are hidden; zooming in brings them back
  function declutter(){
    if(!map)return;
    var kept=[];
    for(var i=0;i<chips.length;i++){
      var p=map.project(chips[i].getLngLat()),ok=!(p.x<112&&p.y<126);
      for(var k=0;ok&&k<kept.length;k++){ if(Math.abs(kept[k].x-p.x)<118&&Math.abs(kept[k].y-p.y)<30)ok=false; }
      chips[i].getElement().style.display=ok?'':'none';
      if(ok)kept.push(p);
    }
  }
  window.__driveMap=function(d){data=d;draw();};
  window.addEventListener('message',function(e){var d=e.data;try{if(typeof d==='string')d=JSON.parse(d);}catch(x){return;} if(d&&d.__driveMap)window.__driveMap(d.__driveMap);});
  function start(style){
    map=new maplibregl.Map({container:'map',style:style,center:[14.5,46.05],zoom:6,attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false});
    map.touchZoomRotate.disableRotation();
    map.on('load',function(){
      msg.style.display='none';
      ['ok','reserve','out'].forEach(function(id){map.addSource(id,{type:'geojson',data:line([])});});
      map.addLayer({id:'out',type:'line',source:'out',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#EF4444','line-width':6,'line-dasharray':[0.1,2]}});
      map.addLayer({id:'reserve-case',type:'line',source:'reserve',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0B0E11','line-width':10}});
      map.addLayer({id:'reserve',type:'line',source:'reserve',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#F59E0B','line-width':6}});
      map.addLayer({id:'ok-case',type:'line',source:'ok',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0B0E11','line-width':10}});
      map.addLayer({id:'ok',type:'line',source:'ok',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#34D17A','line-width':6}});
      ready=true; draw();
      // the map credit stays, but folded to its small (i) so it does not cover the map
      var at=document.querySelector('.maplibregl-ctrl-attrib');
      if(at){at.classList.remove('maplibregl-compact-show');at.removeAttribute('open');}
    });
    map.on('moveend',declutter);
    map.on('dragstart',function(){moved=true;fitBtn.style.display='flex';});
    map.on('zoomstart',function(e){if(e.originalEvent){moved=true;fitBtn.style.display='flex';}});
  }
  fitBtn.addEventListener('click',function(){moved=false;fitBtn.style.display='none';fit(true);});
  if(!window.maplibregl){msg.textContent='Map needs an internet connection';return;}
  // dark style; if it cannot be loaded, the standard one
  fetch('https://tiles.openfreemap.org/styles/dark').then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(s){start(s);}).catch(function(){
    try{start('https://tiles.openfreemap.org/styles/liberty');}catch(e){msg.textContent='Map not available';}
  });
  try{ if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('ready'); else if(window.parent!==window)window.parent.postMessage('driveMapReady','*'); }catch(e){}
})();
</script></body></html>`;
