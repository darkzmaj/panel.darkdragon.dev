<?php

namespace Pterodactyl\Http\Controllers\Api\Client;

use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Services\Servers\ServerLayoutService;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\ServerOrderRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\ServerCategoryRequest;

/**
 * The signed in user's personal ordering and categories for the server list.
 */
class ServerLayoutController extends ClientApiController
{
    public function __construct(private ServerLayoutService $layout)
    {
        parent::__construct();
    }

    public function index(ClientApiRequest $request): JsonResponse
    {
        return new JsonResponse($this->layout->layout($request->user()));
    }

    public function reorder(ServerOrderRequest $request): JsonResponse
    {
        $this->layout->reorder($request->user(), $request->validated('servers'));

        return new JsonResponse($this->layout->layout($request->user()));
    }

    public function storeCategory(ServerCategoryRequest $request): JsonResponse
    {
        $this->layout->createCategory($request->user(), $request->validated('name'), $request->validated('servers', []));

        return new JsonResponse($this->layout->layout($request->user()), Response::HTTP_CREATED);
    }

    public function updateCategory(ServerCategoryRequest $request, int $category): JsonResponse
    {
        $this->layout->updateCategory($request->user(), $category, $request->validated('name'), $request->validated('servers', []));

        return new JsonResponse($this->layout->layout($request->user()));
    }

    public function reorderCategory(ServerOrderRequest $request, int $category): JsonResponse
    {
        $this->layout->reorderCategory($request->user(), $category, $request->validated('servers'));

        return new JsonResponse($this->layout->layout($request->user()));
    }

    public function reorderCategories(ClientApiRequest $request): JsonResponse
    {
        $request->validate(['categories' => 'required|array|max:50', 'categories.*' => 'integer']);
        $this->layout->reorderCategories($request->user(), $request->input('categories'));

        return new JsonResponse($this->layout->layout($request->user()));
    }

    public function deleteCategory(ClientApiRequest $request, int $category): JsonResponse
    {
        $this->layout->deleteCategory($request->user(), $category);

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}
