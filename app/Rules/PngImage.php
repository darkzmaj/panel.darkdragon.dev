<?php

namespace Pterodactyl\Rules;

use Illuminate\Http\UploadedFile;
use Pterodactyl\Services\Media\PngImageProcessor;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Verifies that an upload really is a PNG by inspecting its content rather
 * than trusting the client supplied file name or MIME type.
 */
class PngImage implements ValidationRule
{
    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        if (!$value instanceof UploadedFile || !$value->isValid() || !PngImageProcessor::isPng($value->getRealPath())) {
            $fail('The :attribute must be a valid PNG image.');
        }
    }
}
