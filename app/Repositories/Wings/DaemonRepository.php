<?php

namespace Pterodactyl\Repositories\Wings;

use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use Pterodactyl\Models\Node;
use Webmozart\Assert\Assert;
use Pterodactyl\Models\Server;
use Pterodactyl\Support\PerfTimings;
use Illuminate\Contracts\Foundation\Application;

abstract class DaemonRepository
{
    protected ?Server $server;

    protected ?Node $node;

    /**
     * DaemonRepository constructor.
     */
    /** @var array<string, Client> */
    private static array $clients = [];

    public function __construct(protected Application $app)
    {
    }

    /**
     * Set the server model this request is stemming from.
     */
    public function setServer(Server $server): self
    {
        $this->server = $server;

        $this->setNode($this->server->node);

        return $this;
    }

    /**
     * Set the node model this request is stemming from.
     */
    public function setNode(Node $node): self
    {
        $this->node = $node;

        return $this;
    }

    /**
     * Return an instance of the Guzzle HTTP Client to be used for requests.
     */
    public function getHttpClient(array $headers = []): Client
    {
        Assert::isInstanceOf($this->node, Node::class);

        // One client per node and header set. Reusing it keeps the underlying connection (and its TLS session) open for
        // the following calls instead of paying for a new handshake each time, which matters for the Overview that
        // calls every node and for the long-lived queue workers. Certificate verification is unchanged.
        $token = $this->node->getDecryptedKey();
        $key = $this->node->id . ':' . md5($token . json_encode($headers) . $this->node->getConnectionAddress());

        return self::$clients[$key] ??= new Client([
            'verify' => $this->app->environment('production'),
            'base_uri' => $this->node->getConnectionAddress(),
            'timeout' => config('pterodactyl.guzzle.timeout'),
            'connect_timeout' => config('pterodactyl.guzzle.connect_timeout'),
            'handler' => $this->handler(),
            'headers' => array_merge($headers, [
                'Authorization' => 'Bearer ' . $token,
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ]),
        ]);
    }

    /**
     * Records how long each Wings call took for the Server-Timing header. Durations only.
     */
    private function handler(): HandlerStack
    {
        $stack = HandlerStack::create();
        $stack->push(function (callable $next) {
            return function ($request, array $options) use ($next) {
                $start = microtime(true);
                $record = fn () => PerfTimings::add('wings', (microtime(true) - $start) * 1000);

                return $next($request, $options)->then(
                    function ($response) use ($record) {
                        $record();

                        return $response;
                    },
                    function ($reason) use ($record) {
                        $record();

                        return \GuzzleHttp\Promise\Create::rejectionFor($reason);
                    }
                );
            };
        });

        return $stack;
    }
}
