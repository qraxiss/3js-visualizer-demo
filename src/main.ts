import './style.css'

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const CAMERA_BASE = 1.5
camera.position.set(0, CAMERA_BASE, 1);
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

const starCount = 8000;
const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(starCount * 3);

for (let i = 0; i < starCount; i++) {
  const i3 = i * 3;
  starPositions[i3] = (Math.random() - 0.5) * 200;
  starPositions[i3 + 1] = (Math.random() - 0.5) * 200;
  starPositions[i3 + 2] = (Math.random() - 0.5) * 200;
}

starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

const loader = new GLTFLoader();

const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

if (audioContext.state === 'suspended') {
  audioContext.resume();
}

const mediaStreamDestination = audioContext.createMediaStreamDestination();

const setupAudioTrack = async (url: string) => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.loop = false;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  const dataArray = new Float32Array(analyser.fftSize);

  source.connect(analyser);
  analyser.connect(audioContext.destination);
  analyser.connect(mediaStreamDestination);

  source.start();

  return { analyser, dataArray, url, source, audioBuffer };
};

const musicName = 'till-i-die'

const [bass, drums, vocal, other] = await Promise.all([
  setupAudioTrack(`${musicName}/bass.mp3`),
  setupAudioTrack(`${musicName}/drums.mp3`),
  setupAudioTrack(`${musicName}/vocal.mp3`),
  setupAudioTrack(`${musicName}/other.mp3`)
]);

const maxDuration = Math.max(
  bass.audioBuffer.duration,
  drums.audioBuffer.duration,
  vocal.audioBuffer.duration,
  other.audioBuffer.duration
);

const girlGlb = await loader.loadAsync('/girl.glb')
scene.add(girlGlb.scene)

const videoStream = (renderer.domElement as HTMLCanvasElement).captureStream();
const audioStream = mediaStreamDestination.stream;
const combinedStream = new MediaStream([
  ...videoStream.getTracks(),
  ...audioStream.getTracks()
]);

const chunks: Blob[] = [];
const recorder = new MediaRecorder(combinedStream, {
  mimeType: 'video/webm; codecs=vp9'
});

recorder.ondataavailable = (event: BlobEvent) => {
  if (event.data.size > 0) {
    chunks.push(event.data);
  }
};

recorder.onstop = () => {
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `${musicName}-recording.webm`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};


window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function getAmplitude(track: {
  analyser: AnalyserNode;
  dataArray: Float32Array;
  url: string;
}) {
  track.analyser.getFloatTimeDomainData(track.dataArray as Float32Array<ArrayBuffer>);

  let sumOfSquares = 0;
  for (let i = 0; i < track.dataArray.length; i++) {
    sumOfSquares += track.dataArray[i] * track.dataArray[i];
  }

  const rms = Math.sqrt(sumOfSquares / track.dataArray.length);

  return rms / 25;
}

function animateStars(amp: number, speedMultiplier: number) {
  const speed = ((amp * 50) + 0.1) * speedMultiplier;
  const positions = (stars.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

  for (let i = 0; i < starCount; i++) {
    const i3 = i * 3 + 2;
    positions[i3] += speed;

    if (positions[i3] > 100) {
      positions[i3] = -100;
    }
  }
  stars.geometry.attributes.position.needsUpdate = true;
}

function rotations(bassAmp: number, drumsAmp: number, vocalAmp: number, otherAmp: number, totalAmp: number): THREE.Vector3 {
  const baseRotate = 0.001

  const X = ((Math.sin(drumsAmp)) + baseRotate)
  const Y = ((bassAmp * 5) + baseRotate)
  const Z = ((Math.sin(vocalAmp)) + baseRotate)

  return new THREE.Vector3(X, Y, Z)
}

girlGlb.scene.rotateX(-1.5)

let lightOrbitAngle = 0;
let orbitAngle = 0;

const globalSpeedFactor = 1.0;

let animationFrameId: number | null = null;

function animate() {
  const bassAmp = getAmplitude(bass)
  const drumsAmp = getAmplitude(drums)
  const vocalAmp = getAmplitude(vocal)
  const otherAmp = getAmplitude(other)

  const totalAmp = bassAmp + drumsAmp + vocalAmp + otherAmp;

  const vocalSlowdownFactor = Math.max(0.05, 1.0 - (vocalAmp * 25));
  const dynamicSpeed = globalSpeedFactor * vocalSlowdownFactor;

  animateStars(totalAmp, dynamicSpeed)

  const rotate = rotations(bassAmp, drumsAmp, vocalAmp, otherAmp, totalAmp)

  girlGlb.scene.rotateY(rotate.y * globalSpeedFactor)

  const lightOrbitSpeed = ((otherAmp * 0.5) + 0.001) * dynamicSpeed;
  lightOrbitAngle += lightOrbitSpeed;
  const lightOrbitRadius = Math.sqrt(5 * 5 + 7.5 * 7.5);
  directionalLight.position.x = Math.sin(lightOrbitAngle) * lightOrbitRadius;
  directionalLight.position.z = Math.cos(lightOrbitAngle) * lightOrbitRadius;

  const orbitRadius = CAMERA_BASE;
  const orbitSpeed = ((totalAmp * 0.01) + 0.005) * dynamicSpeed;
  orbitAngle += orbitSpeed;


  camera.position.x = (CAMERA_BASE / 4 + Math.cos((orbitAngle + vocalAmp)) * orbitRadius);
  camera.position.z = Math.sin(orbitAngle) * orbitRadius;
  camera.position.y = Math.sin(orbitAngle) * orbitRadius;

  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);


  animationFrameId = requestAnimationFrame(animate);
}

animate();

// recorder.start();

// setTimeout(() => {
//   recorder.stop();
//   if (animationFrameId) {
//       cancelAnimationFrame(animationFrameId);
//   }
//   audioContext.close();
// }, maxDuration * 1000);