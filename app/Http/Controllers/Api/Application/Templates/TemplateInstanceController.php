<?php

namespace Pterodactyl\Http\Controllers\Api\Application\Templates;

use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Illuminate\Validation\ValidationException;
use Pterodactyl\Services\Templates\TemplateInstanceService;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Pterodactyl\Transformers\Api\Application\TemplateInstanceTransformer;
use Pterodactyl\Http\Controllers\Api\Application\ApplicationApiController;
use Pterodactyl\Http\Requests\Api\Application\Templates\ReadTemplateRequest;
use Pterodactyl\Http\Requests\Api\Application\Templates\CreateTemplateInstanceRequest;
use Pterodactyl\Http\Requests\Api\Application\Templates\DeleteTemplateInstanceRequest;

class TemplateInstanceController extends ApplicationApiController
{
    /** The only request fields that are ever read. Anything else is rejected rather than silently ignored. */
    private const ALLOWED_FIELDS = ['name', 'owner_id', 'description', 'environment'];

    public function __construct(private TemplateInstanceService $instances)
    {
        parent::__construct();
    }

    /**
     * Queues the creation of a server from a template. Provisioning is asynchronous: the response contains the
     * job (instance) id to poll. Sending the same Idempotency-Key with the same body returns the original job.
     *
     * @throws \Throwable
     */
    public function store(CreateTemplateInstanceRequest $request, ServerTemplate $template): JsonResponse
    {
        $unknown = array_diff(array_keys($request->all()), self::ALLOWED_FIELDS);
        if ($unknown) {
            throw ValidationException::withMessages(collect($unknown)->mapWithKeys(fn ($field) => [$field => 'This field is not accepted. Instances are built from the template.'])->all());
        }

        [$instance, $created] = $this->instances->request(
            $template,
            $request->only(self::ALLOWED_FIELDS),
            $request->user()->currentAccessToken(),
            $request->header('Idempotency-Key')
        );

        return $this->respondWithInstance($instance)
            ->setStatusCode($created ? 202 : 200)
            ->header('Location', route('api.application.templates.instances.view', ['template' => $template->id, 'instance' => $instance->uuid]));
    }

    public function view(ReadTemplateRequest $request, ServerTemplate $template, TemplateInstance $instance): array
    {
        $this->assertBelongs($template, $instance);

        return $this->fractal->item($instance)
            ->transformWith($this->getTransformer(TemplateInstanceTransformer::class))
            ->toArray();
    }

    /**
     * @throws \Pterodactyl\Exceptions\DisplayException
     */
    public function retry(CreateTemplateInstanceRequest $request, ServerTemplate $template, TemplateInstance $instance): JsonResponse
    {
        $this->assertBelongs($template, $instance);

        return $this->respondWithInstance($this->instances->retry($instance))->setStatusCode(202);
    }

    /**
     * @throws \Pterodactyl\Exceptions\DisplayException
     */
    public function delete(DeleteTemplateInstanceRequest $request, ServerTemplate $template, TemplateInstance $instance): Response
    {
        $this->assertBelongs($template, $instance);
        $this->instances->destroy($instance);

        return $this->returnNoContent();
    }

    private function respondWithInstance(TemplateInstance $instance): JsonResponse
    {
        return $this->fractal->item($instance)
            ->transformWith($this->getTransformer(TemplateInstanceTransformer::class))
            ->respond(200);
    }

    private function assertBelongs(ServerTemplate $template, TemplateInstance $instance): void
    {
        if ($instance->template_id !== $template->id) {
            throw new NotFoundHttpException();
        }
    }
}
