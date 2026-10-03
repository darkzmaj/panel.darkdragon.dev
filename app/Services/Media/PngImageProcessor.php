<?php

namespace Pterodactyl\Services\Media;

use Pterodactyl\Exceptions\DisplayException;

class PngImageProcessor
{
    /**
     * The largest width or height that will be decoded. Prevents decompression
     * bombs from exhausting memory since the full bitmap must be loaded to re-encode it.
     */
    public const MAX_SOURCE_DIMENSION = 4096;

    private const SIGNATURE = "\x89PNG\r\n\x1a\n";

    /**
     * Determine if the file at the given path is a PNG with sane dimensions, based
     * entirely on its content.
     */
    public static function isPng(string|false $path): bool
    {
        if ($path === false || !is_file($path)) {
            return false;
        }

        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }
        $signature = fread($handle, strlen(self::SIGNATURE));
        fclose($handle);

        if ($signature !== self::SIGNATURE || (new \finfo(FILEINFO_MIME_TYPE))->file($path) !== 'image/png') {
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
     * Decode the PNG at the given path and re-encode it as a fresh PNG that fits within
     * the given bounds. Images are never enlarged. Re-encoding discards any ancillary
     * chunks or trailing data that were smuggled into the original upload.
     *
     * When $square is true the image is center-cropped to a square before scaling.
     *
     * @throws DisplayException
     */
    public function normalize(string $path, int $maxWidth, int $maxHeight, bool $square = false): string
    {
        if (!self::isPng($path)) {
            throw new DisplayException('The uploaded file is not a valid PNG image.');
        }

        $source = imagecreatefrompng($path);
        if ($source === false) {
            throw new DisplayException('The uploaded PNG image could not be processed.');
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
        imagefill($target, 0, 0, imagecolorallocatealpha($target, 0, 0, 0, 127));
        imagecopyresampled($target, $source, 0, 0, $srcX, $srcY, $targetWidth, $targetHeight, $width, $height);

        ob_start();
        imagepng($target, null, 9);
        $contents = ob_get_clean();

        if ($contents === false || $contents === '') {
            throw new DisplayException('The uploaded PNG image could not be processed.');
        }

        return $contents;
    }
}
