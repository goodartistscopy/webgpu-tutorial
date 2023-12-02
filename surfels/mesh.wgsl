struct Camera {
    view: mat4x4f,
    inv_view: mat4x4f,
    proj: mat4x4f
}

struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) cs_position: vec3f, // camera space position
    @location(1) normal: vec3f,
    @location(2) local_uv: vec2f,
}

struct MeshData {
    model: mat4x4f,
    inv_model: mat4x4f,
    color: vec4f,
    size_factor: f32
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
    let cs_position = pos_xform * vec4f(vertex.position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    out.local_uv = vec2f(0.0);

    return out;
}

struct QuadVertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) local_uv: vec2f,
}

@vertex fn vsQuad(vertex: QuadVertexIn) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(vertex.position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    out.local_uv = vertex.local_uv;
    return out;
}

struct QuadVertexIn2 {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) size: f32
}

fn buildTSpaceMatrix(n: vec3f) -> mat2x3f {
    var t: vec3f;
    if abs(n.z) < abs(n.y) {
        t = cross(n, vec3f(0.0, 0.0, 1.0));
    } else {
        t = cross(n, vec3f(0.0, 1.0, 0.0));
    }
    let b = cross(n, t);
    return mat2x3f(t, b);
}

@vertex fn vsQuad2(vertex: QuadVertexIn2, @builtin(vertex_index) vIdx: u32) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    let k = vIdx % 4u;
    let corner = mesh.size_factor * vertex.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(vertex.normal));
    let position = vertex.position + tsXform * corner;

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}

struct QuadVertexIn3{
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) size: f32
}

@vertex fn vsQuad3(vertex: QuadVertexIn3, @builtin(vertex_index) vIdx: u32) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    let k = vIdx % 4u;
    let corner = mesh.size_factor * vertex.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(vertex.normal));
    let position = vertex.position + tsXform * corner;

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}

// fields shuffled around to limit alignment waste
struct PointData {
    position: vec3f,
    size: f32,
    normal: vec3f,
}

@group(2) @binding(0) var<storage> points: array<PointData>;

@vertex fn vsQuad4(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) instIdx: u32) -> VertexOut {
    let vertex = points[instIdx];

    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    let k = vIdx % 4u;
    let corner = mesh.size_factor * vertex.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(vertex.normal));
    let position = vertex.position + tsXform * corner;

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}


struct FragmentIn {
    @builtin(position) frag_coord: vec4f,
    @location(0) cs_position: vec3f,
    @location(1) normal: vec3f,
    @location(2) local_uv: vec2f,
}

@fragment fn fragmentMain(frag: FragmentIn, @builtin(front_facing) front_facing: bool) -> @location(0) vec4f {
    let l_cs = scene.camera.view * vec4f(scene.light.position, 1.0);
    let l = normalize(l_cs.xyz - frag.cs_position);
    var n = normalize(frag.normal);
    if (!front_facing) {
        n = -n;
    }
    let reflectance = max(dot(n, l), 0.0);

    if (dot(frag.local_uv, frag.local_uv) > 1.0) {
        discard;
    }

    return vec4f(reflectance * mesh.color.rgb * scene.light.color, mesh.color.a);
}
