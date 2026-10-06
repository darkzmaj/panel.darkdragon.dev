<?php

declare(strict_types=1);

namespace GobiaTemplates\Http\Controllers;

use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Services\TemplateInstanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Models\ApiKey;
use Pterodactyl\Services\Acl\Api\AdminAcl;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Provisioning API for automation (billing, bots). Stricter than the rest of the Application API: it needs an
 * application API key with servers permission (read to look, write to create, retry or delete), and only templates an
 * administrator explicitly enabled for the API can be used. Session logins and account keys are never enough.
 */
#[Group('Gobia templates')]
class ApplicationTemplateController
{
    /** Anything else in the request is rejected rather than silently ignored. */
    private const array ALLOWED_FIELDS = ['name', 'owner_id', 'description', 'environment'];

    public function __construct(private readonly TemplateInstanceService $instances) {}

    #[Endpoint('List API templates')]
    public function index(Request $request): JsonResponse
    {
        $this->authorise($request, AdminAcl::READ);
        $templates = ServerTemplate::query()->where(['enabled' => true, 'api_enabled' => true])->orderBy('name')->get();

        return new JsonResponse(['data' => $templates->map(fn (ServerTemplate $template): array => $this->templatePayload($template))->all()]);
    }

    #[Endpoint('Show an API template')]
    public function view(Request $request, ServerTemplate $template): JsonResponse
    {
        $this->authorise($request, AdminAcl::READ);

        return new JsonResponse($this->templatePayload($this->template($template)));
    }

    #[Endpoint('Create an instance', 'Queues provisioning (202). The same Idempotency-Key with the same body returns the original job (200).')]
    public function store(Request $request, ServerTemplate $template): JsonResponse
    {
        $this->authorise($request, AdminAcl::WRITE);
        $unknown = array_diff(array_keys($request->all()), self::ALLOWED_FIELDS);
        if ($unknown !== []) {
            throw ValidationException::withMessages(collect($unknown)->mapWithKeys(fn ($field): array => [$field => 'This field is not accepted. Instances are built from the template.'])->all());
        }

        [$instance, $created] = $this->instances->request($this->template($template), $request->only(self::ALLOWED_FIELDS), $request->user()->currentAccessToken(), $request->header('Idempotency-Key'));

        return (new JsonResponse($this->instancePayload($instance), $created ? 202 : 200))
            ->header('Location', url("/api/application/extensions/gobia-templates/templates/{$template->id}/instances/{$instance->uuid}"));
    }

    #[Endpoint('Instance status')]
    public function viewInstance(Request $request, ServerTemplate $template, string $instance): JsonResponse
    {
        $this->authorise($request, AdminAcl::READ);

        return new JsonResponse($this->instancePayload($this->find($template, $instance)));
    }

    #[Endpoint('Retry a failed instance')]
    public function retry(Request $request, ServerTemplate $template, string $instance): JsonResponse
    {
        $this->authorise($request, AdminAcl::WRITE);

        return new JsonResponse($this->instancePayload($this->instances->retry($this->find($template, $instance))), 202);
    }

    #[Endpoint('Delete an instance', 'Deletes the server it created and the record.')]
    public function destroy(Request $request, ServerTemplate $template, string $instance): JsonResponse
    {
        $this->authorise($request, AdminAcl::WRITE);
        $this->instances->destroy($this->find($template, $instance));

        return new JsonResponse(null, 204);
    }

    private function authorise(Request $request, int $level): void
    {
        $token = $request->user()?->currentAccessToken();
        throw_unless($token instanceof ApiKey && $token->key_type === ApiKey::TYPE_APPLICATION && AdminAcl::check($token, AdminAcl::RESOURCE_SERVERS, $level), AccessDeniedHttpException::class, 'This endpoint needs an application API key with servers permission.');
    }

    private function template(ServerTemplate $template): ServerTemplate
    {
        throw_unless($template->enabled && $template->api_enabled, NotFoundHttpException::class);

        return $template;
    }

    private function find(ServerTemplate $template, string $uuid): TemplateInstance
    {
        $this->template($template);

        return TemplateInstance::query()->where(['uuid' => $uuid, 'template_id' => $template->id])->firstOrFail();
    }

    /** @return array<string, mixed> */
    private function templatePayload(ServerTemplate $template): array
    {
        return ['id' => $template->id, 'name' => $template->name, 'description' => $template->description, 'revision' => $template->revision];
    }

    /** @return array<string, mixed> */
    private function instancePayload(TemplateInstance $instance): array
    {
        return [
            'id' => $instance->uuid,
            'name' => $instance->name,
            'state' => $instance->state,
            'finished' => $instance->isFinished(),
            'failed_stage' => $instance->failed_stage,
            'error' => $instance->error,
            'attempts' => $instance->attempts,
            'template_revision' => $instance->template_revision,
            'server' => $instance->server_id === null ? null : $instance->server?->uuid,
            'stage_ms' => $instance->stage_ms,
        ];
    }
}
