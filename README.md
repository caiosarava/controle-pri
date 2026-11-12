# Controle da Pri 💗

Um app de celular (PWA) para controlar as finanças de quem dirige por aplicativo (Uber, 99…).
Não tem login: o app é de uma pessoa só. Os dados ficam numa **planilha do Google Sheets no seu Drive** e também no celular, então o app funciona sem internet e envia tudo quando a conexão voltar.

## O que o app faz

- **Início (dashboard):** lucro líquido, ganhos e gastos por **semana, mês ou ano**, com setas para ver períodos anteriores e gastos separados por tipo.
- **Lembrete "Guarde este mês"** (sempre no topo): quanto separar para a **depreciação do carro** e para a **reserva de manutenção**, com o botão "Separei" para marcar quando já guardou.
- **Gastos:** valor, tipo (Combustível, Alimentação, Manutenção ou Outros), data (atalhos "Hoje" e "Ontem") e uma observação, se quiser.
- **Ganhos:** o valor líquido do mês que caiu de cada aplicativo (Uber, 99 ou Outro).
- **Histórico:** todos os lançamentos por mês. Toque em um lançamento para editar ou excluir (dá para desfazer).

### Como os números são calculados

| Item | Fórmula |
|---|---|
| Lucro líquido | ganhos − gastos do período |
| Depreciação | valor do carro × % ao ano (÷ 12 no mês, ÷ 52 na semana) |
| Reserva de manutenção | % dos ganhos do período |
| Depois das reservas | lucro líquido − depreciação − reserva |

Como o ganho é lançado por mês, a **semana** mostra a parte proporcional: ganho do mês ÷ dias do mês × 7.
Os valores padrão são 10% de depreciação ao ano e 10% dos ganhos para manutenção. Dá para mudar em **Ajustes** (engrenagem no topo).

---

## 1. Criar a planilha e a API (uma vez só, ~5 min)

1. Abra o [Google Sheets](https://sheets.new) e crie uma planilha, por exemplo **Controle da Pri**.
2. No menu, vá em **Extensões → Apps Script**.
3. Apague o código que aparece e cole todo o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs).
4. Na linha `const TOKEN = 'troque-esta-senha';`, troque o texto por uma senha só sua (ex.: `pri2026rosa`). Salve (💾).
5. Escolha a função **`setup`** no menu de funções e clique em **▶ Executar**. Autorize com sua conta Google. Se aparecer "app não verificado", clique em *Avançado → Acessar (não seguro)*: o código é seu e só acessa esta planilha.
   As abas **Ganhos**, **Gastos** e **Config** vão aparecer na planilha.
6. Clique em **Implantar → Nova implantação**, escolha a engrenagem e o tipo **App da Web** e configure:
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
7. Clique em **Implantar** e copie a **URL do app da Web** (termina em `/exec`).

> Se você mudar o código depois, use **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão**. Assim a URL continua a mesma.

## 2. Publicar no Vercel

1. Entre em [vercel.com](https://vercel.com) com sua conta do GitHub.
2. Clique em **Add New → Project** e importe o repositório `controle-pri`.
3. Não precisa mudar nada: o `vercel.json` já diz que o site está na pasta `public`. Clique em **Deploy**.
4. Você vai receber um endereço como `https://controle-pri.vercel.app`.

## 3. Instalar no Android

1. Abra o endereço do Vercel no **Chrome** do celular.
2. Toque em **⋮ → Instalar app** (ou "Adicionar à tela inicial").
3. Abra o app, toque na **engrenagem**, cole a URL do Apps Script e a senha, depois toque em **Salvar e conectar**.

Pronto! O indicador no topo mostra **Salvo** (verde) quando tudo foi enviado para a planilha, **pendente** (laranja) quando falta enviar e **Sem internet** (vermelho) quando você está offline.
Segure o ícone do app para usar os atalhos **Registrar gasto** e **Ganho do mês**.

---

## Estrutura do projeto

```
public/
  index.html             telas do app
  styles.css             visual (tons de rosa e lilás, com modo escuro automático)
  app.js                 lógica, cálculos e sincronização
  sw.js                  service worker (funciona offline)
  manifest.webmanifest   dados para instalar o app
  icons/                 ícones do app
apps-script/Code.gs      API que salva os dados na planilha
vercel.json              configuração do deploy
```

É HTML, CSS e JavaScript puros, sem build e sem dependências. Para testar no computador:

```bash
cd public && python3 -m http.server 8080
```

Depois abra http://localhost:8080.
