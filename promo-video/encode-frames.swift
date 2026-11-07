// 把一个目录里按文件名排序的 JPEG/PNG 帧编码成 H.264 MP4。
// 用法：encode-frames <framesDir> <output.mp4> [fps]
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: encode-frames <framesDir> <output.mp4> [fps]\n".data(using: .utf8)!)
  exit(1)
}
let framesDir = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let fps = Int32(args.count > 3 ? Int(args[3]) ?? 30 : 30)

let files = try FileManager.default.contentsOfDirectory(at: framesDir, includingPropertiesForKeys: nil)
  .filter { ["jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }
guard let first = files.first,
  let firstSrc = CGImageSourceCreateWithURL(first as CFURL, nil),
  let firstImg = CGImageSourceCreateImageAtIndex(firstSrc, 0, nil)
else {
  FileHandle.standardError.write("no frames found\n".data(using: .utf8)!)
  exit(1)
}
let width = firstImg.width
let height = firstImg.height

try? FileManager.default.removeItem(at: outURL)
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let compression: [String: Any] = [
  AVVideoAverageBitRateKey: 14_000_000,
  AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
  AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
]
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: compression,
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
for (i, file) in files.enumerated() {
  autoreleasepool {
    guard let src = CGImageSourceCreateWithURL(file as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil),
      let pool = adaptor.pixelBufferPool
    else { return }
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
    guard let buffer = pb else { return }
    CVPixelBufferLockBaseAddress(buffer, [])
    let ctx = CGContext(
      data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(buffer, [])
    while !input.isReadyForMoreMediaData { usleep(2000) }
    adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
  }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed {
  FileHandle.standardError.write("encode failed: \(String(describing: writer.error))\n".data(using: .utf8)!)
  exit(1)
}
print("encoded \(files.count) frames → \(outURL.path)")

