# Camera test fixtures

Derived from the public-domain NASA portrait of astronaut Eileen Collins (NASA, via scikit-image's `data.astronaut()`).

* `face_ok` – cropped so the face fills about 60% of the frame
* `face_dark_proxy` – the same frame scaled to 45% brightness with a warm tint. This is a **luminance proxy for darker skin**, not a photograph of darker skin; the light check is relative and must not call it "too dark"
* `face_dim` – 14% brightness: genuinely underexposed
* `face_blur` – Gaussian blur
* `face_tilt` – head rolled 22 degrees
* `face_far` – face about a quarter of the frame
* `face_two` – two faces

`*.mjpeg` files are repeated JPEG frames, used with Chromium's `--use-file-for-fake-video-capture`. `*.jpg` are single frames used for the upload fallback.
These do not replace tests on real devices and real skin tones. See docs/TESTING.md.
