import * as THREE from "three";
import { GARDEN_FRUITS } from "./garden-data.ts";

/** An editorial sculpture, independent of market data, wallets and network access. */
export function mountGarden(stage: HTMLElement): () => void {
  const viewport = stage.querySelector<HTMLElement>("[data-garden-viewport]")!;
  const labels = stage.querySelector<HTMLElement>("[data-garden-labels]")!;
  const status = stage.querySelector<HTMLElement>("[data-garden-status]")!;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);
  const tree = new THREE.Group();
  scene.add(tree);
  scene.add(new THREE.HemisphereLight(0xfff6dd, 0x64714e, 1.9));
  const sun = new THREE.DirectionalLight(0xffedcd, 3.2);
  sun.position.set(-3, 7, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-3.5;sun.shadow.camera.right=3.5;
  sun.shadow.camera.top=4;sun.shadow.camera.bottom=-3;sun.shadow.normalBias=0.035;sun.shadow.bias=-0.0002;
  sun.shadow.radius=4;scene.add(sun);
  const fill = new THREE.DirectionalLight(0xe1f5d6, 1.1);
  fill.position.set(3, 3, -5); scene.add(fill);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  function material(color: string) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 });
    materials.push(mat); return mat;
  }
  function geometry<T extends THREE.BufferGeometry>(value: T): T { geometries.push(value); return value; }
  function mesh(shape: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = tree) {
    const result = new THREE.Mesh(shape, mat); result.castShadow=true;result.receiveShadow=true;parent.add(result); return result;
  }
  const bark = ["#745035", "#88613f", "#96724d"].map(material);
  // Fine longitudinal bark relief keeps smooth wood from looking like molded plastic.
  const barkCanvas=document.createElement("canvas");barkCanvas.width=128;barkCanvas.height=256;
  const ctx=barkCanvas.getContext("2d")!;ctx.fillStyle="#999";ctx.fillRect(0,0,128,256);
  for(let i=0;i<70;i++){
    ctx.strokeStyle=`rgba(35,25,15,${0.08+(i%5)*0.04})`;ctx.lineWidth=0.5+(i%3)*0.45;ctx.beginPath();
    for(let y=0;y<=256;y+=4){const x=(i*17.31)%128+Math.sin(y*0.035+i)*1.6;y===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();
  }
  const barkTexture=new THREE.CanvasTexture(barkCanvas);barkTexture.wrapS=THREE.RepeatWrapping;
  bark.forEach(mat=>{mat.bumpMap=barkTexture;mat.bumpScale=0.045;});
  const foliage = ["#38673b", "#497c40", "#5d8746", "#74934d", "#889f58"].map(material);
  const leafShape = geometry(new THREE.SphereGeometry(1, 20, 14));
  const leafVertices=leafShape.attributes.position!;
  for(let i=0;i<leafVertices.count;i++){
    const x=leafVertices.getX(i),y=leafVertices.getY(i),z=leafVertices.getZ(i);
    const r=1+0.065*Math.sin(x*7+z*4)*Math.cos(y*6-z*3);
    leafVertices.setXYZ(i,x*r,y*r,z*r);
  }leafShape.computeVertexNormals();
  const twigShape = geometry(new THREE.CylinderGeometry(1, 1, 1, 12));
  function curvedWood(path: THREE.Curve<THREE.Vector3>,start:number,end:number,mat:THREE.Material,parent:THREE.Object3D=tree){
    const shape=geometry(new THREE.TubeGeometry(path,20,1,12,false));const positions=shape.attributes.position!;
    for(let ring=0;ring<=20;ring++){
      const t=ring/20,center=path.getPointAt(t),radius=THREE.MathUtils.lerp(start,end,t);
      for(let side=0;side<=12;side++){
        const index=ring*13+side;
        const point=new THREE.Vector3().fromBufferAttribute(positions,index).sub(center).multiplyScalar(radius).add(center);
        positions.setXYZ(index,point.x,point.y,point.z);
      }
    }shape.computeVertexNormals();return mesh(shape,mat,parent);
  }
  function limb(from: THREE.Vector3,to: THREE.Vector3,start:number,end:number,mat:THREE.Material,parent:THREE.Object3D=tree){
    const mid=from.clone().lerp(to,0.5);mid.y-=from.distanceTo(to)*0.12;
    return curvedWood(new THREE.QuadraticBezierCurve3(from,mid,to),start,end,mat,parent);
  }
  const trunk = [new THREE.Vector3(0,-1.68,0), new THREE.Vector3(-0.13,-0.95,0.04), new THREE.Vector3(0.04,-0.2,-0.05), new THREE.Vector3(-0.1,0.65,0), new THREE.Vector3(0.08,1.65,0.05)];
  curvedWood(new THREE.CatmullRomCurve3(trunk),0.29,0.06,bark[1]!);
  // Roots and forks follow a full radial structure, with no designated front.
  for(let i=0;i<7;i++){
    const a=i*Math.PI*2/7;
    limb(new THREE.Vector3(-0.04,-1.27,0),new THREE.Vector3(Math.cos(a)*0.62,-1.67,Math.sin(a)*0.62),0.12,0.025,bark[i%3]!);
  }
  for(let i=0;i<10;i++){
    const a=i*Math.PI*2/10+0.16, r=1.05+(i%2)*0.12;
    const fork=new THREE.Vector3(Math.cos(a)*r,0.2+(i%3)*0.22,Math.sin(a)*r);
    limb(new THREE.Vector3(-0.05,-0.48+(i%2)*0.3,0),fork,0.14,0.065,bark[i%3]!);
    limb(fork,new THREE.Vector3(Math.cos(a)*1.5,0.8+(i%3)*0.23,Math.sin(a)*1.5),0.065,0.025,bark[(i+1)%3]!);
  }
  const leafPlacements:THREE.Matrix4[]=[];
  const dummy=new THREE.Object3D();
  function leaf(x: number,y: number,z: number,sx: number,sy: number,sz: number,index: number){
    const cluster=mesh(leafShape,foliage[index%foliage.length]!);
    cluster.position.set(x,y,z);cluster.scale.set(sx,sy,sz);
    cluster.rotation.set(index*0.37,index*0.71,index*0.23);
    if(sx>0.5)for(let j=0;j<24;j++){
      const a=j*2.399+index, v=1-2*(j+0.5)/24, r=Math.sqrt(1-v*v);
      const normal=new THREE.Vector3(Math.cos(a)*r,v,Math.sin(a)*r);
      dummy.position.set(x+normal.x*sx,y+normal.y*sy,z+normal.z*sz);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
      dummy.rotateZ(j*1.7);dummy.scale.set(0.105+(j%3)*0.015,0.20+(j%4)*0.018,0.026);dummy.updateMatrix();leafPlacements.push(dummy.matrix.clone());
    }
  }
  // Overlapping, staggered whorls create a closed crown through all 360 degrees.
  leaf(0,1.08,0,1.32,1.05,1.32,2);
  for(let tier=0;tier<3;tier++){
    const count=tier===2?6:10, radius=[1.03,0.98,0.43][tier]!;
    for(let i=0;i<count;i++){
      const a=i*Math.PI*2/count+tier*0.36;
      const y=[0.72,1.43,2.05][tier]!+Math.sin(i*2.7)*0.12;
      const s=tier===2?0.68:0.78;
      leaf(Math.cos(a)*radius,y,Math.sin(a)*radius,s,0.6,s,i+tier*3);
      // Small leaf tips break up the silhouette without a stack of brick courses.
      leaf(Math.cos(a)*(radius+0.31),y+0.2,Math.sin(a)*(radius+0.31),0.42,0.25,0.38,i+tier+2);
    }
  }
  const detailLeaf=geometry(new THREE.SphereGeometry(1,8,6));
  const leafDetails=new THREE.InstancedMesh(detailLeaf,material("#ffffff"),leafPlacements.length);
  leafPlacements.forEach((matrix,i)=>{leafDetails.setMatrixAt(i,matrix);leafDetails.setColorAt(i,new THREE.Color(["#719b43","#8aaa53","#507e39","#63934a"][i%4]!));});
  leafDetails.castShadow=false;leafDetails.receiveShadow=true;leafDetails.raycast=()=>{};tree.add(leafDetails);

  // A soft grassy clearing, with planted detail visible from every side.
  const groundShape=geometry(new THREE.SphereGeometry(1,48,20));
  const groundVertices=groundShape.attributes.position!;
  for(let i=0;i<groundVertices.count;i++){
    const x=groundVertices.getX(i),z=groundVertices.getZ(i),a=Math.atan2(z,x),r=1+0.045*Math.sin(a*5)+0.025*Math.cos(a*3);
    groundVertices.setX(i,x*r);groundVertices.setZ(i,z*r);
  }groundShape.computeVertexNormals();
  const soil=mesh(groundShape,material("#8d7450"));soil.position.y=-1.84;soil.scale.set(2.3,0.15,2.18);
  const lawn=mesh(groundShape,material("#879e57"));lawn.position.y=-1.73;lawn.scale.set(2.31,0.13,2.19);
  const grassShape=geometry(new THREE.BufferGeometry());
  grassShape.setAttribute("position",new THREE.Float32BufferAttribute([-0.018,0,0,0.018,0,0,0.012,0.16,0.015,-0.012,0.16,0.015,0.06,0.32,0.04],3));
  grassShape.setIndex([0,1,2,0,2,3,3,2,4]);grassShape.computeVertexNormals();
  const grassMat=material("#ffffff");grassMat.side=THREE.DoubleSide;
  const grasses=new THREE.InstancedMesh(grassShape,grassMat,260);
  for(let i=0;i<260;i++){
    const tuft=Math.floor(i/5),a=tuft*2.399,r=0.65+Math.sqrt((tuft+0.5)/52)*1.44;
    dummy.position.set(Math.cos(a)*r+Math.sin(i*2.1)*0.06,-1.72,Math.sin(a)*r*0.94+Math.cos(i*1.7)*0.06);dummy.rotation.set(0,a*3,Math.sin(i)*0.17);
    dummy.scale.setScalar(0.5+(i%7)*0.08);dummy.updateMatrix();grasses.setMatrixAt(i,dummy.matrix);
    grasses.setColorAt(i,new THREE.Color(["#73963b","#a9bd65","#92ad4f"][i%3]!));
  }grasses.castShadow=false;grasses.receiveShadow=true;grasses.raycast=()=>{};tree.add(grasses);
  const stoneMat=material("#a4a28b"),petalMat=material("#fff0cc"),pollenMat=material("#e5b456");
  for(let i=0;i<11;i++){
    const a=i*2.399+0.7,r=1.3+(i%3)*0.24;
    const rock=mesh(leafShape,stoneMat);rock.position.set(Math.cos(a)*r,-1.66,Math.sin(a)*r);
    rock.scale.set(0.12+(i%3)*0.065,0.09+(i%2)*0.04,0.13+(i%2)*0.08);rock.rotation.y=a;
  }
  for(let i=0;i<12;i++){
    const a=i*2.399,r=1.05+(i%4)*0.25,x=Math.cos(a)*r,z=Math.sin(a)*r;
    const stem=mesh(twigShape,foliage[0]!);stem.scale.set(0.012,0.2,0.012);stem.position.set(x,-1.55,z);
    for(let j=0;j<5;j++){
      const p=j*Math.PI*2/5,petal=mesh(detailLeaf,petalMat);petal.position.set(x+Math.cos(p)*0.057,-1.44,z+Math.sin(p)*0.057);petal.scale.set(0.055,0.016,0.029);petal.rotation.y=-p;
    }
    const center=mesh(detailLeaf,pollenMat);center.position.set(x,-1.423,z);center.scale.set(0.028,0.021,0.028);
  }
  const appleShape=geometry(new THREE.SphereGeometry(0.29,28,20));
  // Pinch the top and bottom and add subtle lobes to the actual 3D fruit geometry.
  const vertices=appleShape.attributes.position!;
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
    const angle=Math.atan2(z,x), lobe=1+0.06*Math.cos(angle*5);
    vertices.setXYZ(i,x*lobe,y*0.92-(y>0.15?0.035:0),z*lobe);
  }
  appleShape.computeVertexNormals();
  const extra=["AMD","NFLX","ORCL","CRM","ADBE","UBER","SHOP","DIS","SPOT","BABA"];
  const identities=[...GARDEN_FRUITS.map(f=>f.symbol),...extra];
  const fruitMats=["#dd7050","#ecc66c","#adc958","#e2cd91"].map(color=>{
    const mat=new THREE.MeshPhysicalMaterial({color,roughness:0.52,metalness:0,clearcoat:0.12,clearcoatRoughness:0.65});materials.push(mat);return mat;
  });
  const fruits=identities.map((symbol,i)=>{
    const tier=i<8?0:i<16?1:2, slot=tier===0?i:tier===1?i-8:i-16;
    const count=tier===2?4:8, a=slot*Math.PI*2/count+[0.12,0.51,0.32][tier]!;
    const r=[1.83,1.72,1.12][tier]!, y=[0.53,1.36,2.13][tier]!+Math.sin(i*2.4)*0.1;
    const home=new THREE.Vector3(Math.sin(a)*r,y,Math.cos(a)*r);
    const group=new THREE.Group();group.position.copy(home);tree.add(group);
    const ball=mesh(appleShape,fruitMats[i%4]!,group);ball.userData.fruitIndex=i;
    const stem=mesh(twigShape,bark[0]!,group);stem.scale.set(0.026,0.19,0.026);stem.position.y=0.31;stem.rotation.z=-0.2;
    const blade=mesh(leafShape,foliage[3]!,group);blade.position.set(0.13,0.36,0);blade.scale.set(0.16,0.04,0.075);blade.rotation.z=0.35;
    const button=document.createElement("button");button.type="button";button.className="garden-fruit-label";
    button.textContent=symbol;button.setAttribute("aria-label",`Drop ${symbol} fruit`);button.dataset.state="attached";
    button.addEventListener("click",()=>drop(i),options);labels.append(button);
    return {group,ball,button,home,velocity:new THREE.Vector3(),state:"attached" as "attached"|"falling"|"regrowing",elapsed:0,bounces:0};
  });
  let yaw=0,pitch=0,disposed=false,visible=true,lastFrame=0,frameId=0,width=1,height=1;
  let drag:{id:number;x:number;y:number;yaw:number;pitch:number;moved:boolean}|null=null;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),world=new THREE.Vector3(),projected=new THREE.Vector3();
  const scale=new THREE.Vector3();
  function drop(index:number){
    const fruit=fruits[index]!;if(fruit.state!=="attached")return;
    if(document.activeElement===fruit.button) viewport.focus({preventScroll:true});
    scene.attach(fruit.group);
    fruit.state="falling";fruit.elapsed=0;fruit.bounces=0;fruit.button.dataset.state="falling";fruit.button.disabled=true;
    fruit.velocity.copy(fruit.group.position).setY(0).normalize().multiplyScalar(0.18);fruit.velocity.y=0.45;
    status.textContent=`${identities[index]} fruit dropped.`;
  }
  function resize(){
    width=viewport.clientWidth;height=viewport.clientHeight;if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;
    camera.position.set(0,2.1,camera.aspect<0.9?11.6:10.0);camera.lookAt(0,0.24,0);camera.updateProjectionMatrix();
  }
  function pick(event:PointerEvent){
    const rect=viewport.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    // Intersect foliage too: an invisible rear fruit must never be clicked through the tree.
    const hit=raycaster.intersectObjects(scene.children,true)[0];
    return hit?.object.userData.fruitIndex as number|undefined;
  }
  viewport.addEventListener("pointerdown",event=>{
    if(event.button!==0||(event.target as HTMLElement).closest("button"))return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,yaw,pitch,moved:false};viewport.setPointerCapture(event.pointerId);viewport.classList.add("is-dragging");
  },options);
  viewport.addEventListener("pointermove",event=>{
    if(drag?.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved ||=Math.abs(dx)+Math.abs(dy)>5;
    yaw=drag.yaw+dx*0.008;pitch=event.pointerType==="touch"?0:THREE.MathUtils.clamp(drag.pitch+dy*0.002,-0.18,0.18);
  },options);
  function endDrag(event:PointerEvent){
    if(drag?.id!==event.pointerId)return;
    if(!drag.moved&&event.type==="pointerup"){const index=pick(event);if(index!==undefined)drop(index);}
    drag=null;viewport.classList.remove("is-dragging");
  }
  for(const name of ["pointerup","pointercancel","lostpointercapture"] as const)viewport.addEventListener(name,endDrag,options);
  viewport.addEventListener("keydown",event=>{
    if(event.target!==viewport||!["ArrowLeft","ArrowRight","Home"].includes(event.key))return;
    event.preventDefault();yaw=event.key==="Home"?0:yaw+(event.key==="ArrowLeft"?-Math.PI/6:Math.PI/6);if(event.key==="Home")pitch=0;
  },options);
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(viewport);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry?.isIntersecting??false;});intersection.observe(stage);
  function frame(now:number){
    if(disposed)return;frameId=requestAnimationFrame(frame);
    if(!visible||document.hidden){lastFrame=now;return;}if(now-lastFrame<32)return;
    const dt=Math.min((now-lastFrame)/1000,0.05);lastFrame=now;
    const smooth=reduceMotion.matches?1:1-Math.exp(-10*dt);
    tree.rotation.y+=(yaw-tree.rotation.y)*smooth;tree.rotation.x+=(pitch-tree.rotation.x)*smooth;
    for(const fruit of fruits){
      if(fruit.state==="falling"){
        fruit.elapsed+=dt;
        if(!reduceMotion.matches){
          fruit.velocity.y-=5.2*dt;fruit.group.position.addScaledVector(fruit.velocity,dt);
          fruit.group.rotation.x+=dt*1.8;fruit.group.rotation.z+=dt*0.8;
          if(fruit.group.position.y < -1.35){fruit.group.position.y=-1.35;fruit.velocity.y=fruit.bounces<2?Math.abs(fruit.velocity.y)*0.3:0;fruit.velocity.x*=0.55;fruit.velocity.z*=0.55;fruit.bounces++;}
        }
        const duration=reduceMotion.matches?0.18:2.3;
        fruit.group.scale.setScalar(Math.max(0,1-Math.max(0,fruit.elapsed-duration+0.35)/0.35));
        if(fruit.elapsed>=duration){
          tree.add(fruit.group);fruit.group.position.copy(fruit.home);fruit.group.rotation.set(0,0,0);fruit.group.scale.setScalar(0);
          fruit.state="regrowing";fruit.button.dataset.state="regrowing";fruit.elapsed=0;
        }
      }else if(fruit.state==="regrowing"){
        fruit.elapsed+=dt;const t=Math.min(1,fruit.elapsed/(reduceMotion.matches?0.15:0.65));fruit.group.scale.setScalar(t*t*(3-2*t));
        if(t===1){fruit.state="attached";fruit.button.dataset.state="attached";fruit.button.disabled=false;}
      }else fruit.group.scale.lerp(scale.setScalar(1),smooth);
    }
    scene.updateMatrixWorld(true);
    const placed:{x:number;y:number}[]=[];
    const ordered=fruits.map(fruit=>{fruit.ball.getWorldPosition(world);return {fruit,position:world.clone(),distance:world.distanceTo(camera.position)};}).sort((a,b)=>a.distance-b.distance);
    for(const {fruit,position,distance}of ordered){
      projected.copy(position).project(camera);const x=(projected.x*0.5+0.5)*width,y=(-projected.y*0.5+0.5)*height;
      raycaster.set(camera.position,position.clone().sub(camera.position).normalize());
      const first=raycaster.intersectObjects(scene.children,true)[0];
      const occluded=first?.object!==fruit.ball;
      const overlap=placed.some(front=>Math.abs(front.x-x)<45&&Math.abs(front.y-y)<29);
      const show=!occluded&&!overlap&&fruit.state==="attached"&&projected.z<1&&x>20&&x<width-20&&y>20&&y<height-20;
      fruit.button.style.visibility=show?"visible":"hidden";
      fruit.button.style.left=`${x}px`;fruit.button.style.top=`${y}px`;fruit.button.style.zIndex=String(Math.round(100-distance));
      if(show)placed.push({x,y});
    }
    renderer.render(scene,camera);
  }
  function dispose(){
    if(disposed)return;disposed=true;cancelAnimationFrame(frameId);controller.abort();resizeObserver.disconnect();intersection.disconnect();
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());barkTexture.dispose();leafDetails.dispose();grasses.dispose();renderer.dispose();renderer.domElement.remove();labels.replaceChildren();stage.classList.remove("garden-ready");
  }
  renderer.domElement.addEventListener("webglcontextlost",event=>{event.preventDefault();dispose();},options);
  stage.classList.add("garden-ready");resize();
  try{renderer.render(scene,camera);}catch(error){dispose();throw error;}
  frameId=requestAnimationFrame(frame);return dispose;
}
