import { readdirSync, writeFileSync } from 'node:fs';
import { open, CAPTURES } from './lib.mjs';

const directory = 'references/Meshy_AI_Captain_of_Tomorrow_biped (1)/Meshy_AI_Captain_of_Tomorrow_biped';
const files = readdirSync(directory).filter(name => name.endsWith('.glb')
  && (!process.argv[2] || new RegExp(process.argv[2]).test(name)));
const errors = [];
const { browser, page } = await open(errors);
try {
  await page.setViewportSize({ width: 1280, height: files.length * 240 });
  await page.evaluate(() => { __demo.renderer.setAnimationLoop(null); });
  const report = await page.evaluate(async ({ directory, files }) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(280, 210);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x293544);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x65718a, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(2, 5, 3);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(38, 280 / 210, .01, 100);
    camera.position.set(2.2, 1.4, 3.4);
    camera.lookAt(0, .9, 0);
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#18212d;color:white;font:12px monospace';
    const output = [];
    for (const file of files) {
      const gltf = await new GLTFLoader().loadAsync(directory + '/' + file);
      const model = gltf.scene;
      model.traverse(n => { if (n.isSkinnedMesh) n.frustumCulled = false; });
      scene.add(model);
      const mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations.reduce((a, b) => a.duration > b.duration ? a : b);
      const action = mixer.clipAction(clip).play();
      action.paused = true;
      const hips = model.getObjectByName('mixamorigHips');
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), forward = new THREE.Vector3();
      const rootSamples = [];
      const row = document.createElement('div');
      row.style.cssText = 'height:240px;display:flex;align-items:center';
      const label = document.createElement('div');
      label.style.cssText = 'width:150px;overflow-wrap:anywhere';
      label.textContent = clip.name;
      row.append(label);
      for (const fraction of [0, .33, .66, .999]) {
        action.time = clip.duration * fraction;
        mixer.update(0);
        hips.getWorldPosition(p);
        hips.getWorldQuaternion(q);
        forward.set(0, 0, 1).applyQuaternion(q);
        rootSamples.push({ time: action.time, position: p.toArray(), yaw: Math.atan2(forward.x, forward.z) });
        model.position.x = -p.x;
        model.position.z = -p.z;
        renderer.render(scene, camera);
        const image = document.createElement('img');
        image.src = renderer.domElement.toDataURL();
        row.append(image);
        model.position.set(0, 0, 0);
      }
      document.body.append(row);
      output.push({ file, clips: gltf.animations.map(c => ({ name: c.name, duration: c.duration, tracks: c.tracks.length })), rootSamples });
      scene.remove(model);
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      model.traverse(n => { if (n.isMesh) { n.geometry.dispose(); n.material.dispose(); } });
    }
    renderer.dispose();
    return output;
  }, { directory, files });
  await page.screenshot({ path: `${CAPTURES}/biped-audit.png`, fullPage: true });
  writeFileSync(`${CAPTURES}/biped-audit.json`, JSON.stringify({ errors, files: report }, null, 2) + '\n');
  console.log(JSON.stringify(report.map(r => ({ name: r.clips[0].name, duration: r.clips[0].duration,
    yaw: r.rootSamples.map(s => Math.round(s.yaw * 180 / Math.PI)), positions: r.rootSamples.map(s => s.position.map(v => +v.toFixed(2))) })), null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
