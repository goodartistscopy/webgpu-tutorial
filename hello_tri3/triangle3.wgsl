struct VertexOut {
    @location(0) color: vec4<f32>,
    @builtin(position) position: vec4<f32>,
}

@vertex fn vertexMain(@builtin(vertex_index) index : u32) -> VertexOut {
    var pos = array<vec2f, 3>(
        vec2f(0.0, 0.5),
        vec2f(-0.5, -0.5),
        vec2f(0.5, -0.7)
    );
    var colors = array<vec3f, 3>(
        vec3f(1.0, 0.0, 0.0),
        vec3f(0.0, 1.0, 0.0),
        vec3f(0.0, 0.0, 0.8),
    );

    var vert: VertexOut;

    vert.position= vec4f(pos[index], 0.0, 1.0);
    vert.color = vec4f(colors[index], 1.0);

    return vert;
}

@group(0) @binding(0) var<uniform> color: vec4f;

struct FragmentIn {
    @location(0) frag_color: vec4<f32>,
}

@fragment fn fragmentMain(fragment: FragmentIn) -> @location(0) vec4f {
    return fragment.frag_color;
}
