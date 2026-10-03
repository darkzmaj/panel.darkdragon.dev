<?php

namespace Pterodactyl\Http\Controllers\Api\Application\Templates;

use Spatie\QueryBuilder\QueryBuilder;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Transformers\Api\Application\TemplateTransformer;
use Pterodactyl\Http\Controllers\Api\Application\ApplicationApiController;
use Pterodactyl\Http\Requests\Api\Application\Templates\ReadTemplateRequest;

class TemplateController extends ApplicationApiController
{
    public function index(ReadTemplateRequest $request): array
    {
        $templates = QueryBuilder::for(ServerTemplate::query())
            ->allowedFilters(['name', 'slug', 'enabled'])
            ->allowedSorts(['id', 'name'])
            ->paginate($request->query('per_page') ?? 50);

        return $this->fractal->collection($templates)
            ->transformWith($this->getTransformer(TemplateTransformer::class))
            ->toArray();
    }

    public function view(ReadTemplateRequest $request, ServerTemplate $template): array
    {
        return $this->fractal->item($template)
            ->transformWith($this->getTransformer(TemplateTransformer::class))
            ->toArray();
    }
}
