# GUGARAM TV Free

IPTV player com **login** e **playlist versionada no repositório**. A lista
de canais não é mais buscada ao vivo a cada requisição: ela é um arquivo
`server/data/playlist.m3u`, atualizado por um script que testa cada canal e
remove os que estão fora do ar, revisado e commitado por você.

## Arquitetura

```
Navegador (login.html / index.html)
        │  HTTPS + cookie de sessão
        ▼
Backend Express (server/)
  ├─ Auth (login, logout, troca de senha)
  ├─ Playlist Service → lê server/data/playlist.m3u (arquivo local)
  ├─ Favorites Service (por usuário)
        │
        └─ server/data/db.json   (usuários + favoritos)

Fora do runtime do servidor:
  npm run update-playlist  →  busca a origem, testa cada canal,
                               regrava server/data/playlist.m3u
```

O servidor publicado **não faz nenhuma requisição de rede externa** para
servir os canais — ele só lê o arquivo local. Isso deixa o serviço mais
rápido, mais previsível (não trava se a origem cair) e sem exigir
`IPTV_PLAYLIST_URL` configurada em produção.

## Estrutura de arquivos

```
gugaram-tv/
├── package.json
├── .env.example
├── .gitignore
├── server/
│   ├── server.js
│   ├── lib/
│   │   ├── m3uParser.js       # parseM3U() + serializeM3U()
│   │   ├── playlistCache.js   # lê server/data/playlist.m3u (cache em memória)
│   │   └── store.js           # usuários/favoritos (JSON)
│   ├── middleware/requireAuth.js
│   ├── routes/{auth,playlist,favorites}.js
│   ├── scripts/
│   │   ├── seed-user.js
│   │   └── update-playlist.js # busca + testa + regrava a playlist
│   └── data/
│       ├── playlist.m3u       # VERSIONADO no git — a lista de canais
│       └── db.json            # gerado em runtime (gitignored)
└── public/
    ├── login.html
    ├── index.html
    ├── css/styles.css
    └── js/app.js
```

## Como executar

```bash
npm install
cp .env.example .env
```

Edite o `.env` e preencha pelo menos:

```
SESSION_SECRET=<gere com: openssl rand -hex 32>
ADMIN_EMAIL=voce@exemplo.com
ADMIN_PASSWORD=<uma senha forte>
```

`IPTV_PLAYLIST_URL` é opcional — só é usada pelo script de atualização da
playlist, não pelo servidor.

Crie o primeiro usuário:

```bash
npm run seed
```

Suba o servidor:

```bash
npm start
```

Acesse `http://localhost:3000` — login, playlist carregada automaticamente
a partir de `server/data/playlist.m3u`.

## Atualizando a lista de canais

A lista **não se atualiza sozinha em produção**. Para atualizar:

```bash
npm run update-playlist
```

O que o script faz:
1. Baixa a playlist de origem (padrão: lista pública da iptv-org, ou
   `IPTV_PLAYLIST_URL`/`--source <url>` se você quiser outra).
2. Faz uma requisição real para **cada canal** (HEAD, com fallback para GET
   parcial), em paralelo com limite de concorrência, para checar se
   responde.
3. Regrava `server/data/playlist.m3u` só com os canais que responderam.
4. Imprime um resumo: quantos ficaram, quantos foram removidos, categorias
   antes/depois.

Para a lista completa da iptv-org (12 mil+ canais), isso costuma levar de
alguns minutos a meia hora, dependendo da sua conexão — a maior parte do
tempo é gasta esperando timeout dos canais que já estão fora do ar.

Parâmetros opcionais:

```bash
node server/scripts/update-playlist.js --source <url> --concurrency 60 --timeout 8000 --output server/data/playlist.m3u
```

Depois de rodar, revise o diff e publique:

```bash
git add server/data/playlist.m3u
git commit -m "chore: atualizar playlist de canais"
git push
```

Como o autodeploy está ligado no Render, o push já dispara um novo deploy
com a lista atualizada. Recomendo rodar isso periodicamente (semanalmente,
por exemplo) para manter a lista limpa.

## Como funciona a ocultação da URL

- **Em produção, a URL de origem nem existe mais no processo do servidor**
  — só o arquivo já processado (`server/data/playlist.m3u`) é lido. Isso é
  ainda mais forte do que só "esconder" a URL: ela simplesmente não é
  necessária para o serviço rodar.
- `IPTV_PLAYLIST_URL` só é usada localmente, por você, ao rodar
  `npm run update-playlist` no seu computador — nunca precisa estar
  configurada no ambiente do Render.
- **Nunca aparece no frontend**: `login.html`, `index.html`,
  `css/styles.css` e `js/app.js` não contêm nenhuma URL de origem — o
  frontend só conhece `/api/playlist`.
- **Nunca aparece em `localStorage`/`sessionStorage`/cookies**: o que fica
  salvo no navegador são preferências de interface e o *id* do último canal
  — nunca uma URL de origem.
- **Erros não revelam detalhes técnicos**: o `console.error` do servidor
  recebe os detalhes; o usuário só vê uma mensagem genérica.

## Sobre as URLs de stream individuais

O requisito pede para tratar `channel.url` (o link de cada transmissão) como
potencialmente sensível também, mas **avaliar** o uso de um proxy — não
exige-lo. Nesta versão, o `url` de cada canal **é enviado ao frontend**,
porque o player roda no navegador do usuário e precisa de uma URL para
reproduzir o vídeo (HTML5 `<video>` + `hls.js`). Um proxy completo de
streaming (reescrevendo manifests `.m3u8` e repassando segmentos) é uma peça
de infraestrutura adicional — hoje o endpoint `GET /api/playlist` já evita
expor a URL de *origem* da lista, que era o requisito obrigatório; adicionar
um proxy de stream fica registrado como evolução futura (seção abaixo).

## Endpoints da API

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| POST | `/api/auth/login` | não | `{email, password}` → cria sessão |
| POST | `/api/auth/logout` | sim | encerra a sessão |
| GET | `/api/auth/session` | não | `{authenticated, email}` |
| POST | `/api/auth/change-password` | sim | `{currentPassword, newPassword}` |
| GET | `/api/playlist` | sim | canais (cache com TTL, nunca a URL de origem) |
| GET | `/api/playlist/refresh` | sim | força nova busca na origem |
| GET | `/api/favorites` | sim | favoritos do usuário logado |
| POST | `/api/favorites/toggle` | sim | `{channelId}` → adiciona/remove |
| DELETE | `/api/favorites` | sim | limpa todos os favoritos |

## Cache da playlist

`IPTV_PLAYLIST_CACHE_TTL` (segundos, padrão 300) controla por quanto tempo a
playlist processada fica em memória no backend antes de ser buscada de novo
na origem — assim vários usuários autenticados não disparam uma requisição
cada um.

## Persistência de usuários e favoritos

Para manter o projeto autocontido (sem exigir instalar um banco de dados
separado), usuários e favoritos ficam em `server/data/db.json`, com a senha
sempre em hash (`bcrypt`). O módulo `server/lib/store.js` isola toda essa
lógica atrás de funções simples (`findUserByEmail`, `getFavorites`, etc.),
então trocar por um banco real (Postgres, SQLite...) depois significa
reescrever apenas esse arquivo — nada nas rotas muda.

## Segurança

- Sessão via cookie `httpOnly`, `sameSite=lax`, e `secure` automático quando
  `NODE_ENV=production` (exige HTTPS).
- Senhas com hash `bcrypt` (12 rounds), nunca em texto puro.
- `.env` e `server/data/db.json` estão no `.gitignore` — nunca commitados.
- Nenhuma rota de API aceita ou expõe a URL da playlist como parâmetro.

## Evolução futura

- Proxy de streaming autorizado para também ocultar as URLs individuais dos
  canais (reescrita de manifests `.m3u8`).
- Trocar `server/lib/store.js` por um banco de dados real.
- Múltiplas playlists por plano/usuário, EPG, PWA, histórico de canais.

## Aviso

Este projeto não distribui, hospeda nem indica listas de canais pagos ou
protegidos. Quem administra o backend é responsável por configurar
`IPTV_PLAYLIST_URL` apenas com uma lista de transmissão para a qual possua
autorização de acesso.
