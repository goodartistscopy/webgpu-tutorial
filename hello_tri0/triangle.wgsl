//override scale: f32 = 1.0;
const scale: f32 = 1.0;

@vertex fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 3>(
        vec2(0.0, 0.5),
        vec2(-0.5, -0.5),
        vec2(0.5, -0.5)
    );
  return vec4f(scale * pos[vertexIndex], 0.0, 1.0);
}

@group(0) @binding(0) var<uniform> color: vec4f;

@fragment fn fragmentMain() -> @location(0) vec4f {
    return vec4f(0.9, 0.4, 0.1, 1.0);
}
