# GUGARAM TV Free

IPTV player com **login** e **playlist privada no backend**. Esta é a versão 2
do projeto: a URL M3U/M3U8 nunca trafega para o navegador — ela vive
exclusivamente em uma variável de ambiente do servidor.

> Isso muda a natureza do projeto: a v1 era 100% estática e podia rodar
> direto de um pendrive. Esta v2 **exige um pequeno servidor Node.js
> rodando** (local, em VPS, ou em qualquer host com Node 18+), porque
> esconder a URL de verdade só é possível se ela nunca chegar ao frontend.

## Arquitetura

```
Navegador (login.html / index.html)
        │  HTTPS + cookie de sessão
        ▼
Backend Express (server/)
  ├─ Auth (login, logout, troca de senha)
  ├─ Playlist Service (busca IPTV_PLAYLIST_URL, faz cache, devolve canais)
  ├─ Favorites Service (por usuário)
        │
        ├─ server/data/db.json   (usuários + favoritos)
        └─ IPTV_PLAYLIST_URL     (origem privada da playlist)
```

A URL original da playlist só é lida em `server/lib/playlistCache.js` e nunca
é incluída em nenhuma resposta JSON, HTML ou JS enviada ao navegador.

## Estrutura de arquivos

```
gugaram-tv/
├── package.json
├── .env.example
├── .gitignore
├── server/
│   ├── server.js              # bootstrap do Express, sessões, rotas
│   ├── lib/
│   │   ├── m3uParser.js       # parser M3U (server-side)
│   │   ├── playlistCache.js   # único módulo que lê IPTV_PLAYLIST_URL
│   │   └── store.js           # persistência em JSON (usuários/favoritos)
│   ├── middleware/
│   │   └── requireAuth.js
│   ├── routes/
│   │   ├── auth.js            # /api/auth/*
│   │   ├── playlist.js        # /api/playlist
│   │   └── favorites.js       # /api/favorites
│   ├── scripts/
│   │   └── seed-user.js       # cria o primeiro usuário
│   └── data/                  # db.json é criado aqui (gitignored)
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

Edite o `.env` e preencha:

```
SESSION_SECRET=<gere com: openssl rand -hex 32>
IPTV_PLAYLIST_URL=<sua URL M3U/M3U8 privada>
ADMIN_EMAIL=voce@exemplo.com
ADMIN_PASSWORD=<uma senha forte>
```

Crie o primeiro usuário (lê `ADMIN_EMAIL`/`ADMIN_PASSWORD` do `.env`):

```bash
npm run seed
```

Suba o servidor:

```bash
npm start
```

Acesse `http://localhost:3000` — você será redirecionado para
`/login.html`. Após autenticar, a playlist é carregada automaticamente e
você cai direto no player, sem nunca ver ou informar a URL da lista.

## Como funciona a ocultação da URL

- **Nunca aparece no frontend**: `login.html`, `index.html`, `css/styles.css`
  e `js/app.js` não contêm nenhuma referência à URL da playlist — ela não
  existe nesses arquivos porque o frontend só conhece endpoints como
  `/api/playlist`, nunca a origem real dos dados.
- **Nunca aparece em `localStorage`/`sessionStorage`/cookies**: o que fica
  salvo no navegador são apenas preferências de interface (autoplay, mostrar
  logos, ordenação) e o *id* do último canal assistido — nunca uma URL.
- **Nunca é devolvida pela API**: `GET /api/playlist` monta a resposta campo
  a campo (`id`, `name`, `logo`, `group`, `url` do stream individual),
  então mesmo que algo mude no backend no futuro, a URL de origem da
  playlist não pode "vazar" por acidente nesse endpoint.
- **Erros não revelam detalhes técnicos**: falhas de rede, formato inválido
  ou configuração ausente sempre retornam a mesma mensagem genérica ao
  usuário; o erro real vai só para o `console.error` do servidor.

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
