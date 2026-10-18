import * as THREE from 'three';
import type { WhiteModelRequest } from '@canvas-cut/core/dist/canvas/white-model';

/** The preview and offline exporter use the same scene and interpolation. */
export class WhiteModelScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material = new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 0.9, metalness: 0 });
  private readonly light: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement, private readonly request: WhiteModelRequest) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(request.width, request.height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(request.background);
    this.camera = new THREE.PerspectiveCamera(request.camera.fov, request.width / request.height, 0.1, 10000);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8b9199', 1.5));
    const bounds = new THREE.Box3();
    request.objects.forEach(object => {
      const geometry = object.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 32, 24)
        : object.shape === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
        : new THREE.BoxGeometry(1, 1, 1);
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.scale.fromArray(object.size);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.scene.add(mesh);
      // Include both endpoint positions, allowing for object rotation.
      const radius = Math.hypot(...object.size) / 2;
      for (const position of [object.position, object.endPosition ?? object.position]) {
        bounds.expandByPoint(new THREE.Vector3(...position).addScalar(radius));
        bounds.expandByPoint(new THREE.Vector3(...position).addScalar(-radius));
      }
    });
    if (request.ground) {
      const geometry = new THREE.PlaneGeometry(4000, 4000);
      this.geometries.push(geometry);
      const ground = new THREE.Mesh(geometry, this.material);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(8, bounds.getSize(new THREE.Vector3()).length() / 2);
    this.light = new THREE.DirectionalLight('#ffffff', request.lightIntensity);
    this.light.position.copy(center).add(new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(radius * 3));
    this.light.target.position.copy(center);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    Object.assign(this.light.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 6 });
    this.light.shadow.normalBias = 0.03;
    this.scene.add(this.light, this.light.target);
    this.render(0);
  }

  render(progress: number) {
    const t = Math.max(0, Math.min(1, progress));
    const lerp = (a: number, b: number) => THREE.MathUtils.lerp(a, b, t);
    const { start, end, target } = this.request.camera;
    this.camera.position.set(...start.map((v, i) => lerp(v, end[i]!)) as [number, number, number]);
    this.camera.lookAt(...target);
    this.request.objects.forEach((object, index) => {
      const mesh = this.meshes[index]!;
      mesh.position.set(...object.position.map((v, i) => lerp(v, (object.endPosition ?? object.position)[i]!)) as [number, number, number]);
      const rotation = object.rotation.map((v, i) => THREE.MathUtils.degToRad(lerp(v, (object.endRotation ?? object.rotation)[i]!)));
      mesh.rotation.set(rotation[0]!, rotation[1]!, rotation[2]!);
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometries.forEach(geometry => geometry.dispose());
    this.material.dispose();
    this.light.shadow.map?.dispose();
    this.renderer.dispose();
  }
}
