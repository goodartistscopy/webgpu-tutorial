//@group(0) @binding(0) var<storage, read_write> data: array<atomic<i32>>;
@group(0) @binding(0) var<storage, read_write> data: array<i32>;

@compute @workgroup_size(16) fn csMain(
    @builtin(global_invocation_id) id: vec3<u32>
    )
{
    data[id.x] = data[id.x] * data[id.x];
    //atomicAdd(&data[0], 1);
}

