struct Camera {
    view: mat4x4f,
    inv_view: mat4x4f,
    proj: mat4x4f
}

struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv0: vec2f
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) cs_position: vec3f, // camera space position
    @location(1) normal: vec3f,
    @location(2) uv0: vec2f,
}

struct MeshData {
    model: mat4x4f,
    inv_model: mat4x4f,
    color: vec4f,
    video_aspect: f32,
}

struct Light {
    position: vec3f,
    color: vec3f,
}

struct SceneData {
    camera: Camera,
    light: Light,
}

@group(0) @binding(0) var<uniform> scene: SceneData;
@group(1) @binding(0) var<uniform> mesh: MeshData;
@group(1) @binding(1) var texture: texture_2d<f32>;
@group(1) @binding(2) var aSampler: sampler;

@vertex fn vertexMain(vertex: VertexIn) -> VertexOut {
    let pos_xform = scene.camera.view * mesh.model;
    let norm_xform = transpose(mesh.inv_model * scene.camera.inv_view);

    var out: VertexOut;
    let cs_position = pos_xform * vec4f(vertex.position, 1.0);
    out.position = scene.camera.proj * cs_position;
    out.cs_position = cs_position.xyz;
    out.normal = (norm_xform * vec4f(vertex.normal, 1.0)).xyz;

    out.uv0 = vertex.uv0;

    return out;
}

struct FragmentIn {
    @builtin(position) coords: vec4f,
    @location(0) cs_position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv0: vec2f,
}

@fragment fn fragmentMain(frag: FragmentIn) -> @location(0) vec4f {
    let l_cs = scene.camera.view * vec4f(scene.light.position, 1.0);
    let l = normalize(l_cs.xyz - frag.cs_position);
    let n = normalize(frag.normal);
    let reflectance = max(dot(n, l), 0.0) + 0.1;

    //let color = textureLoad(texture, vec2i(frag.uv0.xy * 3) % 3, 0);
    let color = textureSample(texture, aSampler, frag.uv0.xy);
    
    return vec4f(reflectance * color.rgb * scene.light.color, color.a);
}

// Entry point for the demonstration of importExternalTexture()
@group(1) @binding(1) var video_texture: texture_external;

@fragment fn fragmentVideoMain(frag: FragmentIn) -> @location(0) vec4f {
    let r = 1.0 / mesh.video_aspect;
    let a = 1.0 / r;
    let b = (r - 1.0) / (2.0 * r);
    let y = a * frag.uv0.y + b;
    var color: vec4f;
    if (y < 0.0) || (y >= 1.0) {
        return vec4f(vec3f(0.0), 1.0);
    } else {
        // textureLoad() and the function below are the only one usable with
        // texture_external types
        return textureSampleBaseClampToEdge(video_texture, aSampler, vec2f(frag.uv0.x, y));
    }
}
