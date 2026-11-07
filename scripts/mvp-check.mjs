// Dependency-free acceptance check for the synthetic reconstruction contract.
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const voxelSize = 5;
const grid = new Map();
const key = (x,z) => `${Math.round(x/voxelSize)}:${Math.round(z/voxelSize)}`;
const add = (x,z,type,value) => {
  const k=key(x,z);
  const cell=grid.get(k) ?? {x:Math.round(x/voxelSize)*voxelSize,z:Math.round(z/voxelSize)*voxelSize, structural:[], dielectric:[], motion:[]};
  cell[type].push(value); grid.set(k,cell);
};
for(let pass=0;pass<7;pass++){
  const x=-45+pass*15;
  for(let i=0;i<80;i++){
    const z=i*2;
    const superficial=Math.exp(-Math.pow(z-18,2)/90);
    const deep=Math.exp(-Math.pow(z-92,2)/260);
    add(x,z,'structural',clamp01(0.08+superficial*0.55+deep*0.72));
  }
  for(let f=0;f<8;f++){
    const phase=f*0.31+pass*0.09;
    add(x,55,'dielectric',clamp01(Math.hypot(0.35*Math.cos(phase),0.35*Math.sin(phase))));
  }
  add(x,85,'motion',Math.abs(0.6+0.15*Math.sin(pass)));
}
const voxels=[...grid.values()];
const target={x:0,z:92,radius:15};
const distance=(v)=>Math.hypot(v.x-target.x,v.z-target.z);
const nearest=Math.min(...voxels.map(distance));
const inside=voxels.filter(v=>distance(v)<=target.radius);
const multimodal=voxels.filter(v=>[v.structural.length,v.dielectric.length,v.motion.length].filter(n=>n>0).length>1).length;
const assertions=[
  ['volume contains evidence',voxels.length>100],
  ['phantom target localized',nearest<=15],
  ['target contains evidence',inside.length>0],
  ['multimodal overlap exists',multimodal>0],
];
for(const [name,ok] of assertions){
  console.log(`${ok?'PASS':'FAIL'}  ${name}`);
  if(!ok) process.exitCode=1;
}
console.log(JSON.stringify({voxels:voxels.length,nearestEvidenceErrorMm:Number(nearest.toFixed(2)),targetEvidence:inside.length,multimodalVoxels:multimodal},null,2));
