<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Services\ServerLayoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;

#[Group('Gobia instances')]
class CategoryController
{
    private const array NAME_RULES = ['required', 'string', 'min:1', 'max:32'];

    public function __construct(private readonly ServerLayoutService $layout) {}

    #[Endpoint('Create a category', 'Creates a personal category.')]
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => self::NAME_RULES]);

        return new JsonResponse($this->layout->createCategory($request->user(), $data['name']), 201);
    }

    #[Endpoint('Rename a category', 'Renames one of the signed in user\'s categories.')]
    public function update(Request $request, int $category): JsonResponse
    {
        $data = $request->validate(['name' => self::NAME_RULES]);
        $this->layout->renameCategory($request->user(), $category, $data['name']);

        return new JsonResponse(['ok' => true]);
    }

    #[Endpoint('Delete a category', 'Deletes a category. The servers in it are not affected.')]
    public function destroy(Request $request, int $category): JsonResponse
    {
        $this->layout->deleteCategory($request->user(), $category);

        return new JsonResponse(['ok' => true]);
    }

    #[Endpoint('Reorder categories', 'Stores the order of all of the signed in user\'s categories.')]
    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate(['categories' => ['required', 'array', 'max:'.ServerLayoutService::MAX_CATEGORIES], 'categories.*' => ['integer']]);
        $this->layout->reorderCategories($request->user(), array_values(array_map('intval', $data['categories'])));

        return new JsonResponse(['ok' => true]);
    }

    #[Endpoint('Set a category\'s servers', 'Replaces the servers in a category.')]
    public function assign(Request $request, int $category): JsonResponse
    {
        $data = $request->validate(['servers' => ['present', 'array', 'max:500'], 'servers.*' => ['required', 'string', 'uuid']]);
        $this->layout->assign($request->user(), $category, array_values($data['servers']));

        return new JsonResponse(['ok' => true]);
    }

    #[Endpoint('Add or remove one server', 'Adds a server to, or removes it from, one category.')]
    public function membership(Request $request, int $category, string $uuid): JsonResponse
    {
        $data = $request->validate(['member' => ['required', 'boolean']]);
        $this->layout->toggleMembership($request->user(), $category, $uuid, (bool) $data['member']);

        return new JsonResponse(['ok' => true]);
    }
}
