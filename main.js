import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';

const canvasContainer = document.getElementById('canvas-container');
const loadingEl = document.getElementById('loading');
const progressText = document.getElementById('progressText');
const resetBtn = document.getElementById('resetView');
const partTitle = document.getElementById('partTitle');
const partContent = document.getElementById('partContent');

let renderer, scene, camera, controls, aircraftRoot, infoMap = {};
let pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let hovered = null;

init();
animate();

async function init() {
	const { clientWidth: w, clientHeight: h } = canvasContainer;
	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(w, h);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	canvasContainer.appendChild(renderer.domElement);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
	camera.position.set(6, 2.2, 6);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.target.set(0, 0.7, 0);

	const ambient = new THREE.AmbientLight(0xffffff, 0.6);
	scene.add(ambient);
	const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
	dirLight.position.set(5, 10, 5);
	dirLight.castShadow = false;
	scene.add(dirLight);

	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(8, 48),
		new THREE.MeshBasicMaterial({ color: 0x0b1220 })
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.01;
	scene.add(ground);

	window.addEventListener('resize', onResize);
	renderer.domElement.addEventListener('pointermove', onPointerMove);
	renderer.domElement.addEventListener('click', onClick);
	resetBtn.addEventListener('click', resetView);

	await Promise.allSettled([
		loadInfo(),
		loadModel()
	]);
	loadingEl.style.display = 'none';
}

function onResize() {
	const { clientWidth: w, clientHeight: h } = canvasContainer;
	camera.aspect = w / h; camera.updateProjectionMatrix();
	renderer.setSize(w, h);
}

function onPointerMove(event) {
	const rect = renderer.domElement.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getPickables() {
	if (!aircraftRoot) return [];
	const pickables = [];
	aircraftRoot.traverse(o => { if (o.isMesh) pickables.push(o); });
	return pickables;
}

function highlight(object, on) {
	if (!object || !object.material) return;
	if (!object.userData._origEmissive) {
		object.userData._origEmissive = object.material.emissive ? object.material.emissive.clone() : new THREE.Color(0x000000);
	}
	if (object.material.emissive) {
		object.material.emissive.set(on ? 0x2266ff : object.userData._origEmissive.getHex());
	}
}

function onClick() {
	raycaster.setFromCamera(pointer, camera);
	const hits = raycaster.intersectObjects(getPickables(), true);
	if (!hits.length) return;
	const hit = hits[0].object;
	const partRoot = findPartRoot(hit);
	if (partRoot) {
		focusOn(partRoot);
		showInfo(partRoot.name);
	}
}

function findPartRoot(object) {
	let o = object;
	while (o && o !== aircraftRoot) {
		if (isPartNode(o)) return o;
		o = o.parent;
	}
	return aircraftRoot;
}

function isPartNode(o) {
	if (!o || !o.name) return false;
	// Heuristic: treat top-level named nodes as parts
	const names = ['Fuselage','Wing.L','Wing.R','Aileron.L','Aileron.R','Elevator','Rudder','Propeller','Engine','Nose','LandingGear'];
	return names.some(n => o.name.includes(n));
}

function focusOn(object3D) {
	const box = new THREE.Box3().setFromObject(object3D);
	const size = new THREE.Vector3();
	box.getSize(size);
	const center = new THREE.Vector3();
	box.getCenter(center);
	const maxDim = Math.max(size.x, size.y, size.z);
	const dist = Math.max(3, maxDim * 2.2);
	const dir = new THREE.Vector3(1.2, 0.6, 1.2).normalize();
	const newPos = center.clone().addScaledVector(dir, dist);
	animateVec3(camera.position, newPos, 600);
	animateVec3(controls.target, center, 600);
}

function animateVec3(vec, to, ms) {
	const from = vec.clone();
	const start = performance.now();
	function tick(now) {
		const t = Math.min(1, (now - start) / ms);
		const eased = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; // cubic inOut
		vec.lerpVectors(from, to, eased);
		if (t < 1) requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
}

function resetView() {
	focusOn(aircraftRoot || scene);
	showInfo('Aircraft');
}

async function loadInfo() {
	try {
		const res = await fetch('./parts.json', { cache: 'no-store' });
		if (!res.ok) throw new Error('HTTP ' + res.status);
		infoMap = await res.json();
	} catch (e) {
		// Fallback content so the viewer works even from file://
		infoMap = {
			"Aircraft": { title: 'AMASE Aircraft', markdown: 'Click a part to view notes.' }
		};
		console.warn('parts.json could not be loaded; using fallback content.', e);
	}
}

async function loadModel() {
const urls = [
		'./assets/A320.glb'
	];
	const loader = new GLTFLoader();
	const draco = new DRACOLoader();
	draco.setDecoderPath('https://www.gstatic.com/draco/v1/');
	loader.setDRACOLoader(draco);

	for (let i = 0; i < urls.length; i++) {
		try {
			await loaderWithTimeout(loader, urls[i], 12000);
			return;
		} catch (e) {
			console.warn('Model load attempt failed, trying next URL', e);
		}
	}
	progressText.textContent = 'Failed to load model';
}

function loaderWithTimeout(loader, url, timeoutMs) {
	return new Promise((resolve, reject) => {
		let done = false;
		const t = setTimeout(() => {
			if (done) return;
			done = true; reject(new Error('Timeout'));
		}, timeoutMs);
		loader.load(url, (gltf) => {
			if (done) return; done = true; clearTimeout(t);
			aircraftRoot = gltf.scene;
			aircraftRoot.name = 'Aircraft';
			aircraftRoot.rotation.y = Math.PI / 8;
			scene.add(aircraftRoot);
			remapNodeNames(aircraftRoot);
			resetView();
			resolve();
		}, (xhr) => {
			const p = xhr.total ? (xhr.loaded / xhr.total * 100) : 0;
			progressText.textContent = `Loading… ${p.toFixed(0)}%`;
		}, (err) => {
			if (done) return; done = true; clearTimeout(t);
			reject(err);
		});
	});
}

function remapNodeNames(root) {
    // Map common A320-style names to our canonical set
    root.traverse(o => {
        if (!o.name || !o.isObject3D) return;
        const name = o.name.toLowerCase();
        if (name.includes('fuselage')) o.name = 'Fuselage';
        if (name === 'wing' || name.includes('wing_l') || name.includes('left_wing')) o.name = 'Wing.L';
        if (name.includes('wing_r') || name.includes('right_wing')) o.name = 'Wing.R';
        if (name.includes('hstab') || name.includes('horizontal')) o.name = 'HStab';
        if (name.includes('vstab') || name.includes('vertical')) o.name = 'VStab';
        if (name.includes('engine') && name.includes('l')) o.name = 'Engine.L';
        if (name.includes('engine') && name.includes('r')) o.name = 'Engine.R';
        if (name.includes('engine') && !o.name.includes('.')) o.name = 'Engine';
        if (name.includes('prop')) o.name = 'Propeller';
    });
}

function showInfo(partName) {
	const key = infoMap[partName] ? partName : 'Aircraft';
	partTitle.textContent = infoMap[key]?.title || key;
	partContent.innerHTML = markdownToHtml(infoMap[key]?.markdown || '');
}

function animate() {
	requestAnimationFrame(animate);
	controls.update();
	updateHover();
	renderer.render(scene, camera);
}

function updateHover() {
	raycaster.setFromCamera(pointer, camera);
	const hits = raycaster.intersectObjects(getPickables(), true);
	const newHovered = hits.length ? hits[0].object : null;
	if (hovered !== newHovered) {
		if (hovered) highlight(hovered, false);
		if (newHovered) highlight(newHovered, true);
		hovered = newHovered;
	}
}

function markdownToHtml(md) {
	if (!md) return '';
	// very small converter: paragraphs + bold/italic + lists
	let html = md
		.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
		.replace(/\*(.*?)\*/g, '<em>$1</em>')
		.replace(/`([^`]+)`/g, '<code>$1</code>');
	const lines = html.split(/\r?\n/);
	let out = '', inList = false;
	for (const line of lines) {
		if (/^\s*[-•]/.test(line)) {
			if (!inList) { out += '<ul>'; inList = true; }
			out += `<li>${line.replace(/^\s*[-•]\s*/, '')}</li>`;
		} else {
			if (inList) { out += '</ul>'; inList = false; }
			if (line.trim()) out += `<p>${line}</p>`;
		}
	}
	if (inList) out += '</ul>';
	return out;
}

