import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DATABASE_NAME = 'void-space-model-thumbnails';
const DATABASE_VERSION = 1;
const STORE_NAME = 'thumbnails';
const THUMBNAIL_SIZE = { width: 640, height: 480 };

let databasePromise: Promise<IDBDatabase> | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let renderQueue: Promise<void> = Promise.resolve();
const pendingRenders = new Map<string, Promise<Blob>>();

export function isThumbnailModelFormat(format: string | null | undefined): boolean {
  const normalised = format?.trim().toLowerCase().replace(/^\./, '');
  return normalised === 'glb' || normalised === 'gltf';
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Persistent thumbnail storage is unavailable in this browser'));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = null;
        reject(request.error ?? new Error('Could not open persistent thumbnail storage'));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error('Persistent thumbnail storage upgrade was blocked'));
      };
    });
  }

  return databasePromise;
}

export async function readModelThumbnail(cid: string): Promise<Blob | null> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(cid);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not read the cached model thumbnail'));
  });
}

export async function storeModelThumbnail(cid: string, thumbnail: Blob): Promise<void> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(thumbnail, cid);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not store the model thumbnail'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Storing the model thumbnail was aborted'));
  });
}

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setSize(THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x171a20, 1);
  return renderer;
}

function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

async function renderThumbnail(modelUrl: string): Promise<Blob> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    34,
    THUMBNAIL_SIZE.width / THUMBNAIL_SIZE.height,
    0.01,
    1000,
  );
  const root = new THREE.Group();
  let loadedModel: THREE.Object3D | null = null;

  scene.background = new THREE.Color(0x171a20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x343b4a, 2.2));

  const keyLight = new THREE.DirectionalLight(0xfff4e8, 3.2);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xb9d7ff, 1.4);
  fillLight.position.set(-5, 2, -4);
  scene.add(fillLight);
  scene.add(root);

  try {
    const gltf = await new GLTFLoader().loadAsync(modelUrl);
    loadedModel = gltf.scene;
    root.add(loadedModel);
    root.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const longestSide = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longestSide) || longestSide <= 0) {
      throw new Error('The model has no renderable geometry');
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 2 / longestSide;
    root.position.copy(center).multiplyScalar(-scale);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const direction = new THREE.Vector3(0.58, 0.38, 0.72).normalize();
    const radius = Math.sqrt(3) * 0.5;
    const distance = (radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.18;
    camera.position.copy(direction.multiplyScalar(distance));
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = distance + radius * 10;
    camera.updateProjectionMatrix();

    const activeRenderer = getRenderer();
    activeRenderer.render(scene, camera);

    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      activeRenderer.domElement.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('The browser could not encode the model thumbnail'));
        },
        'image/jpeg',
        0.84,
      );
    });

    return thumbnail;
  } finally {
    if (loadedModel) disposeModel(loadedModel);
    scene.clear();
  }
}

export function renderModelThumbnail(cid: string, modelUrl: string): Promise<Blob> {
  const pending = pendingRenders.get(cid);
  if (pending) return pending;

  const render = renderQueue.then(() => renderThumbnail(modelUrl));
  renderQueue = render.then(
    () => undefined,
    () => undefined,
  );
  pendingRenders.set(cid, render);
  const removePending = () => {
    if (pendingRenders.get(cid) === render) pendingRenders.delete(cid);
  };
  void render.then(removePending, removePending);
  return render;
}
