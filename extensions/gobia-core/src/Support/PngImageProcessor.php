<?php

declare(strict_types=1);

namespace GobiaCore\Support;

use finfo;
use Illuminate\Validation\ValidationException;

/**
 * Decodes an uploaded PNG and re-encodes it as a fresh, bounded PNG. Re-encoding drops ancillary chunks and any data
 * appended to the original file, so nothing the client smuggled in survives.
 */
class PngImageProcessor
{
    /** Largest width or height that will be decoded; the full bitmap must be in memory to re-encode it. */
    public const int MAX_SOURCE_DIMENSION = 4096;

    private const string SIGNATURE = "\x89PNG\r\n\x1a\n";

    /** True only for a real PNG (signature, detected type, declared type) with sane dimensions. */
    public static function isPng(string $path): bool
    {
        if (! is_file($path)) {
            return false;
        }

        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }
        $signature = fread($handle, mb_strlen(self::SIGNATURE, '8bit'));
        fclose($handle);

        if ($signature !== self::SIGNATURE || (new finfo(FILEINFO_MIME_TYPE))->file($path) !== 'image/png') {
            return false;
        }

        $info = @getimagesize($path);

        return $info !== false
            && $info[2] === IMAGETYPE_PNG
            && $info[0] > 0
            && $info[1] > 0
            && $info[0] <= self::MAX_SOURCE_DIMENSION
            && $info[1] <= self::MAX_SOURCE_DIMENSION;
    }

    /**
     * Re-encode the PNG so it fits within the bounds (never enlarging). With `$square` the image is first
     * center cropped to a square.
     *
     * @throws ValidationException
     */
    public function normalize(string $path, int $maxWidth, int $maxHeight, bool $square = false): string
    {
        if (! self::isPng($path)) {
            throw ValidationException::withMessages(['avatar' => 'The uploaded file is not a valid PNG image.']);
        }

        $source = @imagecreatefrompng($path);
        if ($source === false) {
            throw ValidationException::withMessages(['avatar' => 'The uploaded PNG image could not be processed.']);
        }

        $width = imagesx($source);
        $height = imagesy($source);
        $srcX = $srcY = 0;

        if ($square) {
            $side = min($width, $height);
            $srcX = intdiv($width - $side, 2);
            $srcY = intdiv($height - $side, 2);
            $width = $height = $side;
        }

        $scale = min(1, $maxWidth / $width, $maxHeight / $height);
        $targetWidth = max(1, (int) round($width * $scale));
        $targetHeight = max(1, (int) round($height * $scale));

        $target = imagecreatetruecolor($targetWidth, $targetHeight);
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagefill($target, 0, 0, (int) imagecolorallocatealpha($target, 0, 0, 0, 127));
        imagecopyresampled($target, $source, 0, 0, $srcX, $srcY, $targetWidth, $targetHeight, $width, $height);

        ob_start();
        imagepng($target, null, 9);
        $contents = ob_get_clean();

        if ($contents === false || $contents === '') {
            throw ValidationException::withMessages(['avatar' => 'The uploaded PNG image could not be processed.']);
        }

        return $contents;
    }
}
