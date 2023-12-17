@group(0) @binding(0) var<storage, read_write> counter: atomic<u32>;
@group(0) @binding(1) var textureOut: texture_storage_2d<rgba8unorm, write>;
    
@compute @workgroup_size(8, 8) fn csMain(
    @builtin(global_invocation_id) coords: vec3<u32>
    )
{
    let c = atomicAdd(&counter, 1);
    let color = unpack4x8unorm(c);
    //let color = vec4f(vec2f(vec2u(coords.xy % 256)) / 255.0, 0.0, 1.0);
    textureStore(textureOut, coords.xy, color);
}


@vertex
fn vsMain(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
    var tri = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );

    return vec4f(tri[id], 0.0, 1.0);
}


@group(0) @binding(0) var textureIn: texture_2d<f32>;

@fragment
fn fsMain(@builtin(position) frag_coord: vec4f) -> @location(0) vec4f {
    var dest = textureLoad(textureIn, vec2i(frag_coord.xy), 0);

    return dest;
}
