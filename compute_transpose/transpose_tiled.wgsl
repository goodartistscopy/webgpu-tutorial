@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dest: texture_storage_2d<rgba8unorm, write>;
    
// Local memory is limited to 16kB, so tile size is limited to 31
@id(0) override TILE_SIZE: u32 = 31;
var<workgroup> tile: array<vec4f, TILE_SIZE * TILE_SIZE>;

@compute @workgroup_size(TILE_SIZE, TILE_SIZE)
fn transpose_tiled(@builtin(global_invocation_id) coords: vec3<u32>,
                    @builtin(local_invocation_id) thread_id: vec3<u32>,
                    @builtin(workgroup_id) group_id: vec3<u32>) {
    tile[thread_id.y * TILE_SIZE + thread_id.x] = textureLoad(src, coords.xy, 0);

    workgroupBarrier();
    
    let x = group_id.y * TILE_SIZE + thread_id.x;
    let y = group_id.x * TILE_SIZE + thread_id.y;

    textureStore(dest, vec2u(x, y), tile[thread_id.x * TILE_SIZE + thread_id.y]);
}
