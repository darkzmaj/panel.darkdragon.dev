<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia;

/**
 * Minimal ustar writer for tests, able to produce hostile archives that real tools refuse to create.
 */
class TarArchive
{
    private string $data = '';

    public function file(string $name, string $content = 'x'): self
    {
        return $this->entry($name, '0', $content, 0644);
    }

    public function directory(string $name): self
    {
        return $this->entry(mb_rtrim($name, '/').'/', '5', '', 0755);
    }

    public function symlink(string $name, string $target): self
    {
        return $this->entry($name, '2', '', 0777, $target);
    }

    public function hardlink(string $name, string $target): self
    {
        return $this->entry($name, '1', '', 0644, $target);
    }

    public function entry(string $name, string $type, string $content, int $mode, string $link = ''): self
    {
        $size = mb_strlen($content, '8bit');
        $header = mb_str_pad($name, 100, "\0")
            .sprintf('%07o', $mode)."\0"
            .sprintf('%07o', 0)."\0"
            .sprintf('%07o', 0)."\0"
            .sprintf('%011o', $size)."\0"
            .sprintf('%011o', 0)."\0"
            .'        '
            .$type
            .mb_str_pad($link, 100, "\0")
            ."ustar\0".'00'
            .mb_str_pad('', 32, "\0").mb_str_pad('', 32, "\0")
            .sprintf('%07o', 0)."\0".sprintf('%07o', 0)."\0";
        $header = mb_str_pad($header, 512, "\0");

        $sum = array_sum((array) unpack('C*', $header));
        $header = substr_replace($header, sprintf('%06o', $sum)."\0 ", 148, 8);

        $this->data .= $header.$content.str_repeat("\0", (512 - $size % 512) % 512);

        return $this;
    }

    /** @param bool $terminate append the two zero blocks that mark the end of a valid archive */
    public function build(bool $terminate = true): string
    {
        return (string) gzencode($this->data.($terminate ? str_repeat("\0", 1024) : ''));
    }
}
