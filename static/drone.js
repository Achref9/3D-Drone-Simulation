import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/build/three.module.js';
import { GLTFLoader } from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/examples/jsm/loaders/RGBELoader.js';
import { Sky } from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/examples/jsm/objects/Sky.js';

// ‹‹ NEW ›› grab your HTML info elements
const speedDisplay    = document.getElementById('speed');
const positionDisplay = document.getElementById('position');

// ‹‹ NEW ›› store last-frame position for speed calc
let prevPosition = new THREE.Vector3();

const ws = new WebSocket('ws://localhost:8080');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.style.margin = 0;
document.body.appendChild(renderer.domElement);

// Sky setup
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 5;
skyUniforms['rayleigh'].value = 2;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.5;
const sun = new THREE.Vector3();

function updateSunPosition() {
    const theta = Math.PI * (0.45 - 0.5);
    const phi = 2 * Math.PI * (0.25 - 0.5);
    sun.set(
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
        Math.sin(phi) * Math.cos(theta)
    );
    skyUniforms['sunPosition'].value.copy(sun);
}
updateSunPosition();

// Variables
let drone, mixer;
let last_yaw = 0, pitch = 0, roll = 0;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const keyboard = {};
let isThirdPerson = true; // Start in third-person view
const clock = new THREE.Clock();

// Speed / tilt control
let speedMultiplier = 1;
let tiltMultiplier = 1;

// Camera offsets
const thirdPersonOffset = new THREE.Vector3(0, 5, -10);
const fpvOffset = new THREE.Vector3(0, 0.6, 0.2);

// Loaders
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
loader.setDRACOLoader(dracoLoader);

// Load Drone
loader.load('/models/Drone.glb', (gltf) => {
    drone = gltf.scene;
    drone.scale.set(5, 5, 5);
    drone.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    scene.add(drone);
    
    mixer = new THREE.AnimationMixer(drone);
    gltf.animations.forEach(clip => {
        const action = mixer.clipAction(clip);
        action.timeScale = 2.5;
        action.play();
    });
    // ‹‹ NEW ›› init prevPosition once drone is ready
    prevPosition.copy(drone.position);
});

// Load Ground / Environment
loader.load('/models/aerodrome.glb', (gltf) => {
    const ground = gltf.scene;
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(0, 0, 0);
    ground.scale.set(1, 1, 1);
    scene.add(ground);
});

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Camera initial position
camera.position.set(0, 15, -25);

// Input handlers
window.addEventListener('keydown', e => {
    const k = e.key.toUpperCase();
    keyboard[k] = true;
    if (k === 'C') {
        speedMultiplier = 2;
        tiltMultiplier = 2;
    }
    if (k === 'V') {
        isThirdPerson = !isThirdPerson;
    }
});

window.addEventListener('keyup', e => {
    const k = e.key.toUpperCase();
    keyboard[k] = false;
    if (k === 'C') {
        speedMultiplier = 1;
        tiltMultiplier = 1;
    }
});

// Animation Loop
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (drone) {
        const baseSpeed = 8;
        const moveSpeed = baseSpeed * delta * speedMultiplier;
        const forward = new THREE.Vector3(0, 0, 1);
        const right = new THREE.Vector3(1, 0, 0);

        // ‹‹ NEW ›› remember old pos
        const oldPos = prevPosition.clone();

        // Movement controls
        let moveX = 0, moveZ = 0;
        if (keyboard['Z']) { moveZ -= 1; drone.position.add(forward.applyQuaternion(drone.quaternion).multiplyScalar(moveSpeed)); }
        if (keyboard['S']) { moveZ += 1; drone.position.add(forward.applyQuaternion(drone.quaternion).multiplyScalar(-moveSpeed)); }
        if (keyboard['D']) { moveX -= 1; drone.position.add(right.applyQuaternion(drone.quaternion).multiplyScalar(-moveSpeed)); }
        if (keyboard['Q']) { moveX += 1; drone.position.add(right.applyQuaternion(drone.quaternion).multiplyScalar(moveSpeed)); }
        if (keyboard['A']) last_yaw += 3 * delta;
        if (keyboard['E']) last_yaw -= 3 * delta;
        if (keyboard['SHIFT']) drone.position.y += moveSpeed;
        if (keyboard['CONTROL']) drone.position.y = Math.max(0, drone.position.y - moveSpeed);

        // Tilt / Banking
        const maxRoll  = THREE.MathUtils.degToRad(15) * tiltMultiplier;
        const maxPitch = THREE.MathUtils.degToRad(10) * tiltMultiplier;
        const targetRoll  = maxRoll  * -moveX;
        const targetPitch = maxPitch *  moveZ;
        roll  += (targetRoll  - roll)  * 5 * delta;
        pitch += (targetPitch - pitch) * 5 * delta;

        // Apply rotation
        euler.set(pitch, last_yaw, roll);
        drone.quaternion.setFromEuler(euler);

        // ‹‹ NEW ›› compute speed & update displays
        const newPos = drone.position.clone();
        const dist   = newPos.distanceTo(oldPos);
        const speed  = dist / delta;
        speedDisplay.textContent    = `Speed: ${speed.toFixed(2)}`;
        positionDisplay.textContent = `Position: (${newPos.x.toFixed(2)}, ${newPos.y.toFixed(2)}, ${newPos.z.toFixed(2)})`;
        // ‹‹ NEW ›› store for next frame
        prevPosition.copy(newPos);

        // Camera follow
        if (isThirdPerson) {
            const idealPosition = drone.position.clone()
                .add(thirdPersonOffset.clone().applyQuaternion(drone.quaternion));
            camera.position.lerp(idealPosition, 0.1);
            camera.lookAt(drone.position);
        } else {
            const fpvPosition = drone.position.clone()
                .add(fpvOffset.clone().applyQuaternion(drone.quaternion));
            camera.position.copy(fpvPosition);
            camera.quaternion.copy(
                drone.quaternion.clone()
                     .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))
            );
        }
    }

    // Update propeller animation
    if (mixer) mixer.update(delta * 30);

    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
