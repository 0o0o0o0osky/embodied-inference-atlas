import copy
import unittest

from extractors.fixed_case_ncu import verify_launch, verify_same_case


class FixedReplayAssociationTests(unittest.TestCase):
    def test_other_input_and_other_launch_cannot_borrow_counters(self):
        native = dict(runtime='flashrt', views=1, prompt=48, chunk=10, denoise=10, warmup=5,
            input_case_id='fixed', output_shape=[10, 7], input_hashes={'image': 'local-proof'}, profiled=True, finite=True)
        verify_same_case(native, native)
        other = copy.deepcopy(native)
        other['views'] = 2
        with self.assertRaises(ValueError): verify_same_case(native, other)
        other = copy.deepcopy(native)
        other['input_hashes']['image'] = 'different-input'
        with self.assertRaises(ValueError): verify_same_case(native, other)
        launch = dict(grid=[16, 1, 1], block=[128, 1, 1], registers_per_thread=64,
            static_shared_memory_bytes=0, dynamic_shared_memory_bytes=32768)
        verify_launch(launch, launch)
        with self.assertRaises(ValueError): verify_launch(launch, {**launch, 'registers_per_thread': 80})


if __name__ == '__main__': unittest.main()
