---
name: conventional-commit
description: Crear un mensaje de commit siguiendo Conventiona Commit. Usar caundo se crea n commit o cuando el usuario pide unmensaje de commit.
---

# Conventional Commit

Cuando generes un mensaje de commit:

1. Mirá el `git diff --staged` para entender QUÉ cambió.
2. Elegí el tipo: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
3. Formato: `tipo(scope): descripción en imperativo`
   - en minúscula, sin punto final, máx. 72 caracteres.
4. Si rompe compatibilidad, agregá `BREAKING CHANGE:` en el cuerpo.

Ejemplo: feat(auth): agregar validación de email en el registro