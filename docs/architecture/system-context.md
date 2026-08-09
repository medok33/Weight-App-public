# System context

## Пользовательский контур

Пользователь открывает web-приложение или mini app внутри MAX, проходит onboarding, eligibility и получает план питания/активности. Вход поддерживает email+пароль с подтверждением почты, VK ID и Telegram Login; MAX идентифицируется только при запуске внутри mini app. SMS login и SMS verification отсутствуют.

## Системные границы

```text
User / MAX Mini App
        |
        v
   apps/web  ---- HTTPS ----  apps/api  ----  PostgreSQL
                                  |  \              |
                                  |   \             +-- audit/outbox
                                  |    +---- apps/worker
                                  |
                                  +---- AI Gateway ---- DeepSeek
                                  +---- Object Storage (private, signed URLs)
                                  +---- Email / VK ID / Telegram / MAX adapters
```

## Доверие и данные

Публичные входы проходят schema validation, rate limits и server-side verification. Health/PII данные минимизируются и не отправляются provider/AI без необходимости. `AuthIdentity.provider + subject` уникальны; внешние токены не являются сессиями продукта. Сессии и cookies выдаёт только собственный API.

