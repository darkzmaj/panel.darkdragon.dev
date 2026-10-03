<?php

namespace Pterodactyl\Tests\Unit\Services\Updater\Support;

/**
 * Minimal ustar writer for tests, able to produce hostile archives that real tools refuse to create.
 */
class TarBuilder
{
    private string $data = '';

    public function file(string $name, string $content = 'x', int $mode = 0644): self
    {
        return $this->entry($name, '0', $content, $mode);
    }

    public function dir(string $name): self
    {
        return $this->entry(rtrim($name, '/') . '/', '5', '', 0755);
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
        $prefix = '';
        if (strlen($name) > 100) {
            $cut = strrpos(substr($name, 0, 156), '/');
            $prefix = substr($name, 0, $cut);
            $name = substr($name, $cut + 1);
        }

        $header = str_pad($name, 100, "\0")
            . sprintf('%07o', $mode) . "\0"
            . sprintf('%07o', 0) . "\0"
            . sprintf('%07o', 0) . "\0"
            . sprintf('%011o', strlen($content)) . "\0"
            . sprintf('%011o', 0) . "\0"
            . '        '
            . $type
            . str_pad($link, 100, "\0")
            . "ustar\0" . '00'
            . str_pad('', 32, "\0") . str_pad('', 32, "\0")
            . sprintf('%07o', 0) . "\0" . sprintf('%07o', 0) . "\0"
            . str_pad($prefix, 155, "\0");
        $header = str_pad($header, 512, "\0");

        $sum = array_sum(unpack('C*', $header));
        $header = substr($header, 0, 148) . sprintf('%06o', $sum) . "\0 " . substr($header, 156);

        $this->data .= $header . $content . str_repeat("\0", (512 - strlen($content) % 512) % 512);

        return $this;
    }

    /**
     * @param bool $terminate append the two zero blocks that mark the end of a valid archive
     */
    public function build(bool $terminate = true): string
    {
        return gzencode($this->data . ($terminate ? str_repeat("\0", 1024) : ''));
    }

    public function raw(): string
    {
        return $this->data . str_repeat("\0", 1024);
    }
}
