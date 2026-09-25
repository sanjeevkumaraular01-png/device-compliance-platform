package activity

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
)

// MaxScreenshotWidth is the width screenshots are downscaled to.
const MaxScreenshotWidth = 1600

// BlurRadius is the on-device blur strength (pixels) when the policy requires it.
const BlurRadius = 12

// PrepareScreenshot downscales, optionally blurs, and JPEG-encodes a capture.
func PrepareScreenshot(src image.Image, blur bool) ([]byte, int, int, error) {
	img := Downscale(toRGBA(src), MaxScreenshotWidth)
	if blur {
		BoxBlur(img, BlurRadius)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 60}); err != nil {
		return nil, 0, 0, err
	}
	b := img.Bounds()
	return buf.Bytes(), b.Dx(), b.Dy(), nil
}

func toRGBA(src image.Image) *image.RGBA {
	if r, ok := src.(*image.RGBA); ok && r.Bounds().Min == (image.Point{}) {
		return r
	}
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), src, b.Min, draw.Src)
	return dst
}

// Downscale shrinks img to at most maxW wide (area-averaging), keeping aspect.
func Downscale(img *image.RGBA, maxW int) *image.RGBA {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	if w <= maxW || maxW <= 0 {
		return img
	}
	nw := maxW
	nh := h * maxW / w
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy0, sy1 := y*h/nh, (y+1)*h/nh
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		for x := 0; x < nw; x++ {
			sx0, sx1 := x*w/nw, (x+1)*w/nw
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			var r, g, bl, a, n int
			for sy := sy0; sy < sy1; sy++ {
				o := sy*img.Stride + sx0*4
				for sx := sx0; sx < sx1; sx++ {
					r += int(img.Pix[o])
					g += int(img.Pix[o+1])
					bl += int(img.Pix[o+2])
					a += int(img.Pix[o+3])
					o += 4
					n++
				}
			}
			d := y*dst.Stride + x*4
			dst.Pix[d], dst.Pix[d+1], dst.Pix[d+2], dst.Pix[d+3] = uint8(r/n), uint8(g/n), uint8(bl/n), uint8(a/n)
		}
	}
	return dst
}

// BoxBlur blurs img in place: three separable box passes approximate a
// Gaussian, enough to make on-screen text unreadable.
func BoxBlur(img *image.RGBA, radius int) {
	if radius < 1 {
		return
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	tmp := make([]uint8, len(img.Pix))
	for pass := 0; pass < 3; pass++ {
		blurLine(img.Pix, tmp, w, h, img.Stride, radius, true)
		blurLine(tmp, img.Pix, w, h, img.Stride, radius, false)
	}
}

// blurLine runs a sliding-window box blur horizontally or vertically,
// clamping at the edges.
func blurLine(src, dst []uint8, w, h, stride, r int, horizontal bool) {
	lines, length := h, w
	if !horizontal {
		lines, length = w, h
	}
	at := func(line, i int) int {
		if horizontal {
			return line*stride + i*4
		}
		return i*stride + line*4
	}
	clamp := func(i int) int {
		if i < 0 {
			return 0
		}
		if i >= length {
			return length - 1
		}
		return i
	}
	win := 2*r + 1
	for line := 0; line < lines; line++ {
		var sum [4]int
		for i := -r; i <= r; i++ {
			o := at(line, clamp(i))
			for c := 0; c < 4; c++ {
				sum[c] += int(src[o+c])
			}
		}
		for i := 0; i < length; i++ {
			o := at(line, i)
			for c := 0; c < 4; c++ {
				dst[o+c] = uint8(sum[c] / win)
			}
			out := at(line, clamp(i-r))
			in := at(line, clamp(i+r+1))
			for c := 0; c < 4; c++ {
				sum[c] += int(src[in+c]) - int(src[out+c])
			}
		}
	}
}
