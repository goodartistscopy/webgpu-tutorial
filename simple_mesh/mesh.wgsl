struct Camera {
    view: mat4x4f,
    inv_view: mat4x4f,
    proj: mat4x4f
}

struct VertexIn {
    // Note: declared as "float32x3" in the vertex buffer descriptpr
    // The last component is automatically filled with value 1.0
    @location(0) position: vec4f, 
    @location(1) normal: vec3f
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) cs_position: vec3f, // camera space position
    @location(1) normal: vec3f
}

struct MeshData {
    model: mat4x4f,
    inv_model: mat4x4f,
    color: vec4f
}

struct Light {
    position: vec3f,
    color: vec3f,
}

struct SceneData {
    camera: Camera,
    light: Light
}

@group(0) @binding(0) var<uniform> scene: SceneData;
@group(1) @binding(0) var<uniform> mesh: MeshData;

@vertex fn vertexMain(vertex: VertexIn) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    var out: VertexOut;
    let cs_position = pos_xform * vertex.position;
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    return out;
}

struct FragmentIn {
    @builtin(position) frag_coord: vec4f,
    @location(0) cs_position: vec3f,
    @location(1) normal: vec3f
}

@fragment fn fragmentMain(frag: FragmentIn) -> @location(0) vec4f {
    let l_cs = scene.camera.view * vec4f(scene.light.position, 1.0);
    let l = normalize(l_cs.xyz - frag.cs_position);
    let n = normalize(frag.normal);
    let reflectance = max(dot(n, l), 0.0);

    return vec4f(reflectance * mesh.color.rgb * scene.light.color, mesh.color.a);
}

