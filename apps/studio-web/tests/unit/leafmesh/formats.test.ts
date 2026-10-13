import {LeafMesh} from '../../../addons/builtin/leafmesh/src/topo'
import {triangulateMesh} from '../../../addons/builtin/leafmesh/src/triangulate'
import {buildDrawGeometry} from '../../../addons/builtin/leafmesh/src/draw_buffers'
import {readOBJ} from '../../../addons/builtin/leafmesh/src/obj_read'
import {buildGlbBinary} from '../../../addons/builtin/leafmesh/src/glb_binary'

describe('LeafMesh Multi-Format 3D Geometry Pipeline', () => {
  function makeQuadMesh(): LeafMesh {
    const mesh = new LeafMesh()
    const v0 = mesh.makeVert([-1, -1, 0])
    const v1 = mesh.makeVert([1, -1, 0])
    const v2 = mesh.makeVert([1, 1, 0])
    const v3 = mesh.makeVert([-1, 1, 0])
    mesh.makeFace([[v0, v1, v2, v3]])
    return mesh
  }

  test('triangulates a quad and extracts render geometry', () => {
    const mesh = makeQuadMesh()
    const tris = triangulateMesh(mesh)
    expect(tris.length).toBe(2)

    const geom = buildDrawGeometry(mesh, tris)
    expect(geom.triCount).toBe(2)
    expect(geom.position.length).toBe(2 * 9) // 2 tris * 3 verts * 3 components
    expect(geom.normal.length).toBe(2 * 9)
  })

  test('buildGlbBinary packs positions and normals into valid glTF 2.0 binary container', () => {
    const mesh = makeQuadMesh()
    const tris = triangulateMesh(mesh)
    const geom = buildDrawGeometry(mesh, tris)

    const vertCount = geom.triCount * 3
    const indices = new Uint16Array(vertCount)
    for (let i = 0; i < vertCount; i++) indices[i] = i

    const glbBytes = buildGlbBinary('TestModel', geom.position, geom.normal, indices)
    expect(glbBytes).toBeInstanceOf(Uint8Array)
    expect(glbBytes.length).toBeGreaterThan(100)

    const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength)
    // Magic 0x46546c67 ('glTF')
    expect(view.getUint32(0, true)).toBe(0x46546c67)
    // Version 2
    expect(view.getUint32(4, true)).toBe(2)
    // Total length matches buffer
    expect(view.getUint32(8, true)).toBe(glbBytes.byteLength)

    // Chunk 0 JSON
    const jsonLen = view.getUint32(12, true)
    expect(view.getUint32(16, true)).toBe(0x4e4f534a) // 'JSON'

    const jsonStr = new TextDecoder().decode(glbBytes.subarray(20, 20 + jsonLen))
    const gltf = JSON.parse(jsonStr)
    expect(gltf.asset.version).toBe('2.0')
    expect(gltf.meshes[0].name).toBe('TestModel')
    expect(gltf.accessors.length).toBe(3)
  })

  test('parses OBJ text into LeafMesh topology and triangulates into GLB', () => {
    const objText = `
v -1.0 -1.0 0.0
v 1.0 -1.0 0.0
v 0.0 1.0 0.0
f 1 2 3
`
    const mesh = new LeafMesh()
    const {stats} = readOBJ(objText, mesh)
    expect(stats.verts).toBe(3)
    expect(stats.faces).toBe(1)

    const tris = triangulateMesh(mesh)
    expect(tris.length).toBe(1)

    const geom = buildDrawGeometry(mesh, tris)
    const indices = new Uint16Array([0, 1, 2])
    const glbBytes = buildGlbBinary('ObjTriangle', geom.position, geom.normal, indices)

    expect(glbBytes.length).toBeGreaterThan(50)
  })

  test('builds Cylinder, Cone, Torus, IcoSphere and Monkey primitives', () => {
    const {makeCylinder, makeCone, makeTorus, makeIcoSphere, makeMonkey} =
      require('../../../addons/builtin/leafmesh/src/primitives')

    const cylMesh = new LeafMesh()
    const cyl = makeCylinder(cylMesh, 16, 1, 2)
    expect(cyl.verts.length).toBe(32)
    expect(cyl.faces.length).toBe(18) // 16 side quads + 2 caps

    const coneMesh = new LeafMesh()
    const cone = makeCone(coneMesh, 16, 1, 2)
    expect(cone.verts.length).toBe(17) // 1 apex + 16 base
    expect(cone.faces.length).toBe(17) // 16 sides + 1 base

    const torusMesh = new LeafMesh()
    const torus = makeTorus(torusMesh, 1, 0.25, 12, 8)
    expect(torus.verts.length).toBe(96)
    expect(torus.faces.length).toBe(96)

    const icoMesh = new LeafMesh()
    const ico = makeIcoSphere(icoMesh, 0, 1)
    expect(ico.verts.length).toBe(12)
    expect(ico.faces.length).toBe(20)

    const monkeyMesh = new LeafMesh()
    const monkey = makeMonkey(monkeyMesh, 1)
    expect(monkey.verts.length).toBeGreaterThan(20)
    expect(monkey.faces.length).toBeGreaterThan(15)
  })

  test('exports and imports Stanford PLY format', () => {
    const {makeCube} = require('../../../addons/builtin/leafmesh/src/primitives')
    const {writePLY, readPLY} = require('../../../addons/builtin/leafmesh/src/ply_format')

    const mesh = new LeafMesh()
    makeCube(mesh, 1)

    const plyText = writePLY(mesh, 'TestCube')
    expect(plyText).toContain('ply')
    expect(plyText).toContain('format ascii 1.0')
    expect(plyText).toContain('element vertex 8')
    expect(plyText).toContain('element face 12') // 6 quads = 12 tris

    const targetMesh = new LeafMesh()
    const stats = readPLY(new TextEncoder().encode(plyText), targetMesh)
    expect(stats.verts).toBe(8)
    expect(stats.faces).toBe(12)
  })

  test('universally exports generic geometry (from ITriangleSource) to GLB, OBJ, STL, and PLY', () => {
    const {exportTrianglesToGLB} = require('../../../addons/builtin/leafmesh/src/glb_binary')
    const {exportTrianglesToOBJ} = require('../../../addons/builtin/leafmesh/src/obj_read')
    const {exportTrianglesToSTL} = require('../../../addons/builtin/leafmesh/src/stl_format')
    const {exportTrianglesToPLY} = require('../../../addons/builtin/leafmesh/src/ply_format')

    // Generic triangle data as produced by ITriangleSource.extractTriangles()
    const genericTriangles = {
      positions: new Float64Array([
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
      ]),
      indices: new Int32Array([0, 1, 2]),
      normals: new Float64Array([
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
      ]),
    }

    // 1. GLB
    const glbBytes = exportTrianglesToGLB(genericTriangles, 'TestTri')
    expect(glbBytes instanceof Uint8Array).toBe(true)
    expect(glbBytes.length).toBeGreaterThan(50)
    // Verify GLB magic 0x46546c67
    const glbView = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength)
    expect(glbView.getUint32(0, true)).toBe(0x46546c67)

    // 2. OBJ
    const objText = exportTrianglesToOBJ(genericTriangles, 'TestTri')
    expect(typeof objText).toBe('string')
    expect(objText).toContain('v 0.000000 0.000000 0.000000')
    expect(objText).toContain('f 1 2 3')

    // 3. STL
    const stlBytes = exportTrianglesToSTL(genericTriangles)
    expect(stlBytes instanceof Uint8Array).toBe(true)
    expect(stlBytes.length).toBe(84 + 50) // 84 bytes header + 1 facet * 50 bytes
    const stlView = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength)
    expect(stlView.getUint32(80, true)).toBe(1) // 1 facet

    // 4. PLY
    const plyText = exportTrianglesToPLY(genericTriangles, 'TestTri')
    expect(typeof plyText).toBe('string')
    expect(plyText).toContain('element vertex 3')
    expect(plyText).toContain('element face 1')
    expect(plyText).toContain('3 0 1 2')
  })
})

