// Common data structures
// SceneData occupies group(0), MeshData occupies group(1)
// In a complex rendering scenario group 1 is expected to be rebound more often
// (once per new mesh in a scene).
struct Camera {
    view: mat4x4f,
    inv_view: mat4x4f,
    proj: mat4x4f
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

//=== Basic render pipeline, using for the "point-list" topology

struct Point {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) cs_position: vec3f, // camera space position
    @location(1) normal: vec3f,
    @location(2) local_uv: vec2f,
}

@vertex fn pointMain(point: Point) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(point.position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(point.normal, 1.0)).xyz;

    out.local_uv = vec2f(0.0);

    return out;
}

//=== Render splats as quads (triangle pair)

struct QuadVertex {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) local_uv: vec2f,
}

@vertex fn vsQuad(vertex: QuadVertex) -> VertexOut {
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

//=== Render splats as quads (triangle pair) whose corners are displaced on the fly
struct Splat {
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

@vertex fn vsQuadProcedural(splat: Splat, @builtin(vertex_index) vIdx: u32) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    let k = vIdx % 4u;
    let corner = mesh.size_factor * splat.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(splat.normal));
    let position = splat.position + tsXform * corner;

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(splat.normal, 1.0)).xyz;

    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}

//=== Render quads using instancing

@vertex fn vsQuadInstancing(splat: Splat, @builtin(vertex_index) vIdx: u32) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    let k = vIdx % 4u;
    let corner = mesh.size_factor * splat.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(splat.normal));
    let position = splat.position + tsXform * corner;

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(splat.normal, 1.0)).xyz;

    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}

//=== Manually retrieve the point cloud data, stored in a storage buffer

// Fields are shuffled around to limit alignment waste
struct Splat2 {
    position: vec3f,
    size: f32,
    normal: vec3f,
}

@group(2) @binding(0) var<storage> splats: array<Splat2>;

@vertex fn vsQuadManual(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) instIdx: u32) -> VertexOut {
    let splat = splats[instIdx];

    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    let k = vIdx % 4u;
    let corner = mesh.size_factor * splat.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(splat.normal));
    let position = splat.position + tsXform * corner;

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    
    out.normal = (norm_xform * vec4f(splat.normal, 1.0)).xyz;

    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}

//=== Common fragment shader used for the above techniques

struct Fragment {
    @builtin(position) frag_coord: vec4f,
    @location(0) cs_position: vec3f,
    @location(1) normal: vec3f,
    @location(2) local_uv: vec2f,
}

// Note that we compute the reflectance at each pixel of the splat, but as n is constant
// across the quad, it could also be computed at the quad corners instead.
@fragment fn drawPoint(frag: Fragment, @builtin(front_facing) front_facing: bool) -> @location(0) vec4f {
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

//=== Fragment shader used for accumulating splats. It outputs a pixel weighted by its distance
//=== to the splat center. Used in combination with (alpha, one) (color channel) and (one, one) (alpha
//=== channel) additive blending node

const SIGMA2: f32 = pow(1.0 / 2.0, 2.0);

@fragment fn splatAccumulate(frag: Fragment, @builtin(front_facing) front_facing: bool) -> @location(0) vec4f {
    let l_cs = scene.camera.view * vec4f(scene.light.position, 1.0);
    let l = normalize(l_cs.xyz - frag.cs_position);
    var n = normalize(frag.normal);
    if (!front_facing) {
        n = -n;
    }
    let reflectance = max(dot(n, l), 0.0);
    
    let d2 = dot(frag.local_uv, frag.local_uv);
    if (d2 > 1.0) {
        discard;
    }
 
    let weight = exp(-d2/(2.0*SIGMA2));
    return vec4f(reflectance * mesh.color.rgb * scene.light.color, weight);
}

//=== Fuzzy-depth Prepass
//=== We remove all unnecessary data and calculations

struct VertexOut2 {
    @builtin(position) position: vec4f,
    @location(0) local_uv: vec2f,
}

struct QuadFragment {
    @builtin(position) position: vec4f,
    @location(0) local_uv: vec2f,
}

@group(2) @binding(0) var<uniform> depth_eps: f32;

@vertex fn vsQuadInstancingDepth(splat: Splat, @builtin(vertex_index) vIdx: u32) -> VertexOut2 {
    let pos_xform = scene.camera.view * mesh.model;

    let k = vIdx % 4u;
    let corner = mesh.size_factor * splat.size * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);
    let tsXform = buildTSpaceMatrix(normalize(splat.normal));
    let position = splat.position + tsXform * corner;

    var cs_position = pos_xform * vec4f(position, 1.0);

    // move the splat back a litlle (along the view direction)
    let d = 1.0 + (depth_eps / length(cs_position.xyz));
    cs_position.x *= d;
    cs_position.y *= d;
    cs_position.z *= d;

    var out: VertexOut2;
    out.position = scene.camera.proj * cs_position;
    out.local_uv = 2.0 * (vec2f(f32(k % 2u), f32(k / 2u)) - 0.5);

    return out;
}

@fragment fn fsQuadInstancingDepth(frag: QuadFragment) {
    let d2 = dot(frag.local_uv, frag.local_uv);
    if (d2 > 1.0) {
        discard;
    }
}

//=== Splat weights normalization pass
//=== Divides the source texture colors by its alpha values

@vertex
fn vsFullScreenTriangle(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
    var tri = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );

    return vec4f(tri[id], 0.0, 1.0);
}

@group(0) @binding(0) var source: texture_2d<f32>;

@fragment
fn normalizeSplatWeights(@builtin(position) frag_coord: vec4f) -> @location(0) vec4f {
    let src = textureLoad(source, vec2i(frag_coord.xy), 0);

    if (src.a > 1e-8) {
        return vec4f(src.rgb / src.a, 1.0);
    } else {
        return vec4f(0.0);
    }
}
