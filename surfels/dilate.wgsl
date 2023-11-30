// full-screen pass dilation operator

@vertex
fn vs(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
    var tri = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );

    return vec4f(tri[id], 0.0, 1.0);
}

struct FilterParams {
    size: u32,
    bg_color: vec4f,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> param: FilterParams;

@fragment
fn fs(@builtin(position) frag_coord: vec4f) -> @location(0) vec4f {
    let hs = vec2i(i32(param.size) / 2);
    var r2 = f32(param.size/2u) - 1.0;
    r2 *= r2;

    var dest = textureLoad(source, vec2i(frag_coord.xy), 0);

    let c0 = max(vec2i(frag_coord.xy) - hs, vec2i(0));
    let c1 = min(vec2i(frag_coord.xy) + hs, vec2i(textureDimensions(source) - 1u));
    for (var i = c0.y; i < c1.y; i++) {
        for (var j = c0.x; j < c1.x; j++) {
            let d = vec2f(f32(j), f32(i)) - frag_coord.xy;
            if (dot(d, d) >= r2) {
                continue;
            }
            let sample = textureLoad(source, vec2i(j, i), 0);
            if (any(sample != param.bg_color)) {
                dest = sample;
            }    
        }
    }

    return dest;
}
