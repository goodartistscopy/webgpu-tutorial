@group(0) @binding(1) var<uniform> theta: f32;

@vertex fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 3>(
        vec2(0.0, 0.5),
        vec2(-0.5, -0.5),
        vec2(0.5, -0.5)
    );
    var rot = mat2x2f(cos(theta), -sin(theta), sin(theta), cos(theta));
  return vec4f(rot * pos[vertexIndex], 0.0, 1.0);
}

@group(0) @binding(0) var<uniform> color: vec4f;

@fragment fn fragmentMain() -> @location(0) vec4f {
    return color;
}
