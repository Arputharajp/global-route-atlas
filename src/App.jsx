import React,{useEffect,useMemo,useRef,useState} from 'react';
import maplibregl from 'maplibre-gl';
import {greatCircle} from '@turf/turf';
import {Plane,Ship,ArrowDownUp,Play,Pause,RotateCcw,Search,Globe2,Info,LoaderCircle} from 'lucide-react';

const MAP_STYLE='https://tiles.openfreemap.org/styles/liberty';

function distanceKm(a,b){const rad=x=>x*Math.PI/180;const dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]);const x=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function routePrefix(geometry, progress){const lines=geometry.type==='MultiLineString'?geometry.coordinates:[geometry.coordinates];const segments=[];let total=0;for(let li=0;li<lines.length;li++){for(let i=1;i<lines[li].length;i++){const d=distanceKm(lines[li][i-1],lines[li][i]);segments.push({line:li,a:lines[li][i-1],b:lines[li][i],d});total+=d;}}let remaining=total*Math.max(0,Math.min(1,progress));const out=lines.map(line=>line.length?[line[0]]:[]);let point=lines[0]?.[0]||[0,0];if(progress<=0)return {type:geometry.type==='MultiLineString'?'MultiLineString':'LineString',coordinates:geometry.type==='MultiLineString'?[]:[],point};for(const seg of segments){if(remaining>=seg.d){out[seg.line].push(seg.b);remaining-=seg.d;point=seg.b;continue;}const t=seg.d?remaining/seg.d:0;point=[seg.a[0]+(seg.b[0]-seg.a[0])*t,seg.a[1]+(seg.b[1]-seg.a[1])*t];out[seg.line].push(point);break;}const filtered=out.filter(line=>line.length>1);return {type:geometry.type==='MultiLineString'?'MultiLineString':'LineString',coordinates:geometry.type==='MultiLineString'?filtered:(filtered[0]||[]),point};}


const AIRPORTS_URL='https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
function parseCsvRow(line){
 const out=[];let value='',quoted=false;
 for(let i=0;i<line.length;i++){
  const ch=line[i];
  if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(ch===','&&!quoted){out.push(value);value='';}
  else value+=ch;
 }
 out.push(value);return out;
}
function parseAirportData(csv){
 return csv.split(/\r?\n/).filter(Boolean).map(line=>parseCsvRow(line)).filter(r=>r.length>=8)
  .map(r=>({id:r[0],name:r[1],city:r[2],country:r[3],iata:r[4]==='\\N'?'':r[4],icao:r[5]==='\\N'?'':r[5],lat:Number(r[6]),lon:Number(r[7]),type:r[12]||'airport'}))
  .filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.name);
}

export default function App(){
 const mapEl=useRef(null),mapRef=useRef(null),raf=useRef(null);
 const [mapReady,setMapReady]=useState(false);
 const [mode,setMode]=useState('air'),[from,setFrom]=useState('Chennai, India'),[to,setTo]=useState('Los Angeles, USA');
 const [fromPlace,setFromPlace]=useState(null),[toPlace,setToPlace]=useState(null),[airports,setAirports]=useState([]),[airportStatus,setAirportStatus]=useState('Loading worldwide airport database…');
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[route,setRoute]=useState(null);
 const [progress,setProgress]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
 const [fromOptions,setFromOptions]=useState([]),[toOptions,setToOptions]=useState([]);
 const [activeField,setActiveField]=useState('');
 const [routeNote,setRouteNote]=useState('Choose two places and calculate a route.');

 useEffect(()=>{
  let alive=true;
  fetch(AIRPORTS_URL).then(r=>{if(!r.ok)throw new Error('Airport data download failed');return r.text()})
   .then(csv=>{if(!alive)return;const list=parseAirportData(csv);setAirports(list);setAirportStatus(`${list.length.toLocaleString()} airport locations loaded worldwide`);})
   .catch(()=>{if(alive)setAirportStatus('Airport dataset unavailable — place search fallback is available');});
  return()=>{alive=false};
 },[]);
 function findAirport(query){
  const q=query.trim().toLowerCase();if(!q)return null;
  return airports.find(a=>a.iata.toLowerCase()===q||a.icao.toLowerCase()===q)
   ||airports.find(a=>a.name.toLowerCase()===q||`${a.city}, ${a.country}`.toLowerCase()===q)
   ||airports.find(a=>a.name.toLowerCase().includes(q)||a.city.toLowerCase()===q);
 }
 useEffect(()=>{
  const map=new maplibregl.Map({container:mapEl.current,style:MAP_STYLE,center:[35,20],zoom:1.45,minZoom:1,maxZoom:12,renderWorldCopies:false});
  map.addControl(new maplibregl.NavigationControl(),'bottom-right');
  map.on('load',()=>{
   map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
   map.addLayer({id:'route-glow',type:'line',source:'route',paint:{'line-color':'#63d9d0','line-width':9,'line-opacity':.18,'line-blur':3}});
   map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#8cf5e6','line-width':3.5,'line-opacity':1}});
   map.addSource('progress-point',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
   map.addLayer({id:'progress-point-layer',type:'circle',source:'progress-point',paint:{'circle-radius':6,'circle-color':'#fff','circle-stroke-color':'#46c9bf','circle-stroke-width':3}});
   map.addSource('endpoints',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
   map.addLayer({id:'endpoint-layer',type:'circle',source:'endpoints',paint:{'circle-radius':5,'circle-color':'#f6d68b','circle-stroke-color':'#172b32','circle-stroke-width':2}});
   setMapReady(true);
  });
  mapRef.current=map;return()=>{if(raf.current)cancelAnimationFrame(raf.current);map.remove()};
 },[]);
 const coords=route?.geometry?.coordinates||[];
 async function geocode(q){
  const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q);
  const r=await fetch(url,{headers:{'Accept-Language':'en'}});
  if(!r.ok)throw new Error('Location search failed. Try again in a moment.');
  const data=await r.json();if(!data.length)throw new Error('Could not find: '+q);
  return {lat:Number(data[0].lat),lon:Number(data[0].lon),label:data[0].display_name};
 }
 async function calculate(){
  setLoading(true);setError('');setPlaying(false);setProgress(0);
  try{
   const a=fromPlace||findAirport(from)||await geocode(from),b=toPlace||findAirport(to)||await geocode(to);
   let geometry,sourceNote;
   if(mode==='sea'){
    const params=new URLSearchParams({from:`${a.lat},${a.lon}`,to:`${b.lat},${b.lon}`});
    const response=await fetch(`/api/sea/route?${params}`);
    if(!response.ok)throw new Error(`Sea router returned ${response.status}. Check the service, API key and whether both points are accessible from water.`);
    const data=await response.json();
    geometry=data.geometry||data.route?.geometry||data;
    if(geometry.type==='Feature')geometry=geometry.geometry;
    if(!geometry.coordinates)throw new Error('Sea router did not return GeoJSON route coordinates.');
    sourceNote='Sea path calculated by the configured global water-routing engine. Check port access and vessel constraints.';
   }else{
    // Geodesic line is a visual great-circle approximation, not an operational airway or flown track.
    const gc=greatCircle([a.lon,a.lat],[b.lon,b.lat],{npoints:160});
    geometry=gc.geometry;
    sourceNote='Great-circle air path approximation. This is not a published airway or an actual flown flight track.';
   }
   if(!['LineString','MultiLineString'].includes(geometry.type))throw new Error('Expected LineString route geometry from the route service.');
   setRoute({geometry,a,b});setFromPlace(a);setToPlace(b);setRouteNote(sourceNote);
   setProgress(0);setPlaying(true);
  }catch(e){setError(e.message||'Could not calculate route.');setRouteNote('No route loaded.');}
  finally{setLoading(false);}
 }
 useEffect(()=>{
  if(!playing||!route)return;
  let last=performance.now();
  const tick=now=>{const dt=now-last;last=now;setProgress(p=>{if(p+dt*speed/18000>=1){setPlaying(false);return 1}return p+dt*speed/18000});raf.current=requestAnimationFrame(tick)};
  raf.current=requestAnimationFrame(tick);return()=>{if(raf.current)cancelAnimationFrame(raf.current)};
 },[playing,speed,route]);
 useEffect(()=>{
  const map=mapRef.current;if(!route||!mapReady||!map||!map.isStyleLoaded())return;
  const lines=route.geometry.type==='MultiLineString'?route.geometry.coordinates:[route.geometry.coordinates];
  const allCoords=lines.flat();
  const visible=routePrefix(route.geometry,progress);
  const point=visible.point;
  map.getSource('route')?.setData({type:'Feature',properties:{},geometry:{type:visible.type,coordinates:visible.coordinates}});
  map.getSource('progress-point')?.setData({type:'Feature',properties:{},geometry:{type:'Point',coordinates:point}});
  map.getSource('endpoints')?.setData({type:'FeatureCollection',features:[route.a,route.b].map(p=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[p.lon,p.lat]}}))});
  if(progress===0){
   const bounds=allCoords.reduce((acc,p)=>acc.extend(p),new maplibregl.LngLatBounds(allCoords[0],allCoords[0]));
   map.fitBounds(bounds,{padding:90,maxZoom:5,duration:1300});
  }
 },[progress,route,mapReady]);
 const percent=Math.round(progress*100);
 const swap=()=>{setFrom(to);setTo(from);setFromPlace(toPlace);setToPlace(fromPlace);setRoute(null);setProgress(0)};
 return <div className="app">
  <header><div className="brand"><div className="brand-icon"><Globe2/></div><div><b>GLOBAL ROUTE ATLAS</b><small>WORLDWIDE AIR & SEA ROUTES</small></div></div><div className="top-tag"><i/> INTERACTIVE MAP</div></header>
  <main><aside className="side">
   <div className="kicker">WORLDWIDE JOURNEY VISUALIZER</div><h1>Every route.<br/><em>One world.</em></h1>
   <p className="desc">Select an origin and destination to draw an animated route across the world map.</p><div className="airport-status"><span className="airport-status-dot"/>{airportStatus}</div>
   <div className="modes"><button className={mode==='air'?'on-air':''} onClick={()=>{setMode('air');setRoute(null);setProgress(0);setError('')}}><Plane size={17}/> Air route</button><button className={mode==='sea'?'on-sea':''} onClick={()=>{setMode('sea');setRoute(null);setProgress(0);setError('')}}><Ship size={17}/> Sea route</button></div>
   <label className="field-label">ORIGIN</label><div className="input-wrap"><span className="pin origin"/> <input list="airport-options-from" value={from} onChange={e=>{setFrom(e.target.value);setFromPlace(null)}} placeholder="Airport, city or IATA / ICAO code"/></div>
   <button className="swap" onClick={swap}><ArrowDownUp size={15}/> Swap origin and destination</button>
   <label className="field-label">DESTINATION</label><div className="input-wrap"><span className="pin dest"/> <input list="airport-options-to" value={to} onChange={e=>{setTo(e.target.value);setToPlace(null)}} placeholder="Airport, city or IATA / ICAO code"/></div>
   <datalist id="airport-options-from">{airports.filter(a=>`${a.city} ${a.name} ${a.iata} ${a.icao}`.toLowerCase().includes(from.toLowerCase())).slice(0,12).map(a=><option key={`from-${a.id}`} value={a.iata?`${a.city}, ${a.country} (${a.iata})`:`${a.city}, ${a.country}`} />)}</datalist><datalist id="airport-options-to">{airports.filter(a=>`${a.city} ${a.name} ${a.iata} ${a.icao}`.toLowerCase().includes(to.toLowerCase())).slice(0,12).map(a=><option key={`to-${a.id}`} value={a.iata?`${a.city}, ${a.country} (${a.iata})`:`${a.city}, ${a.country}`} />)}</datalist>
   <button className="calculate" onClick={calculate} disabled={loading||!from.trim()||!to.trim()}>{loading?<LoaderCircle className="spin" size={17}/>:<Search size={17}/>} {loading?'Calculating route':'Show animated route'}</button>
   {error&&<div className="error">{error}</div>}
   <div className="rule"/>
   <div className="control-head"><span>ROUTE PLAYBACK</span><b>{percent}%</b></div>
   <div className="playback"><button disabled={!route} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={17}/>:<Play size={17} fill="currentColor"/>}{playing?'Pause':'Play'}</button><button className="reset" disabled={!route} onClick={()=>{setPlaying(false);setProgress(0)}}><RotateCcw size={16}/></button></div>
   <input className="scrub" type="range" min="0" max="100" value={percent} disabled={!route} onChange={e=>{setPlaying(false);setProgress(Number(e.target.value)/100)}}/>
   <div className="speed-row"><span>Animation speed</span><select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
   <div className="note"><Info size={16}/><span>{routeNote}</span></div>
   <div className="disclaimer">Airport locations load from OpenFlights. The dataset provides airport coordinates, not airway geometry. Route accuracy depends on the selected route source. Air mode draws a great-circle approximation; sea mode uses the server-side water-routing service.</div>
  </aside>
  <section className="map-area"><div ref={mapEl} className="map"/><div className="map-label"><span className={mode==='air'?'air-dot':'sea-dot'}/>{mode==='air'?'AIR ROUTE':'SEA ROUTE'} <b>·</b> WORLDWIDE</div><div className="map-bottom">GLOBAL MAP · OPENFREEMAP / MAPLIBRE</div></section></main>
  <footer><span>GLOBAL ROUTE ATLAS</span><span>Open map technology · route data source shown in panel</span></footer>
 </div>
}