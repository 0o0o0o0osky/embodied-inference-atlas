"""Shared sanitized CUDA/API vocabulary and launch geometry."""
API_NAMES=['cudaGraphLaunch', 'cudaStreamSynchronize', 'cudaDeviceSynchronize', 'cudaEventSynchronize', 'cudaMemcpyAsync', 'cudaMemcpy', 'cudaMalloc', 'cudaFree', 'cudaLaunchKernel', 'cudaLaunchKernelExC', 'cuLaunchKernel', 'cuLaunchKernelEx', 'pthread_cond_wait', 'pthread_cond_timedwait', 'pthread_mutex_lock', 'pthread_mutex_trylock', 'pthread_cond_broadcast', 'sem_timedwait', 'poll', 'read', 'write', 'ioctl']

LAUNCH_KEYS=('gridX','gridY','gridZ','blockX','blockY','blockZ','registersPerThread','staticSharedMemory','dynamicSharedMemory')

def launch_config(row):
    return dict(grid=[row[k] for k in ('gridX','gridY','gridZ')],block=[row[k] for k in ('blockX','blockY','blockZ')],
        registers_per_thread=row['registersPerThread'],static_shared_memory_bytes=row['staticSharedMemory'],
        dynamic_shared_memory_bytes=row['dynamicSharedMemory'],waves_per_sm=None)
