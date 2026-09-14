# Guia de Deploy — ViaHub Condução Econômica

## 1. Preparar o Supabase

### 1.1. Executar o schema.sql

1. Acesse o painel do Supabase: https://app.supabase.com
2. Vá para seu projeto → **SQL Editor**
3. Clique em **+ New Query**
4. Cole o conteúdo completo do arquivo `schema.sql` do repositório
5. Clique em **Run** e aguarde a conclusão

⚠️ **Certifique-se de que não há erros** — você deve ver mensagens de sucesso para todas as tabelas criadas.

### 1.2. Criar usuários de teste (opcional)

No **SQL Editor**, execute:

```sql
-- Criar empresa de teste
INSERT INTO empresas (nome, cnpj) VALUES ('Transabril', '41.705.476/0001-05') RETURNING id;
-- Copie o ID da empresa acima

-- Criar veículos (exemplo)
INSERT INTO veiculos (empresa_id, placa, modelo_equipamento, capacidade) 
VALUES ('UUID_DA_EMPRESA', 'SIE1F96', 'MTC800-ADV', 'com_can');

-- Criar motoristas (exemplo)
INSERT INTO motoristas (empresa_id, nome, cpf, matricula) 
VALUES ('UUID_DA_EMPRESA', 'José Joel Teodoro', '570.000.006-00', '201');
```

**Depois, no Supabase Auth:**
1. Vá para **Authentication** → **Users**
2. Clique em **Add user**
3. Email: `gestor@viahub.local`, Password: seu teste
4. Crie também usuários com papéis diferentes (`master_drive`, `admin_gamificacao`)

**Na tabela `usuarios`:**

```sql
-- Vincular usuários aos seus papéis
INSERT INTO usuarios (id, empresa_id, nome, papel) 
VALUES ('UUID_DO_USER_AUTH', 'UUID_DA_EMPRESA', 'Gestor Teste', 'gestor');
```

---

## 2. Fazer Push no GitHub

### 2.1. Criar repositório GitHub

```bash
# Criar repositório vazio em https://github.com/new (privado recomendado)
# Copiar o HTTPS URL do repositório

cd viahub-conducao-economica

# Adicionar origin e fazer push
git remote add origin https://github.com/SEU_USER/viahub-conducao-economica.git
git branch -M main
git push -u origin main
```

---

## 3. Deploy na Vercel

### 3.1. Conectar Vercel ao repositório

1. Vá para https://vercel.com/dashboard
2. Clique em **Add New Project**
3. Selecione **Import Git Repository**
4. Selecione seu repositório `viahub-conducao-economica`
5. Clique em **Import**

### 3.2. Configurar variáveis de ambiente

Na tela de configuração do projeto Vercel:

1. Vá para **Environment Variables**
2. Adicione as 3 variáveis:

```
NEXT_PUBLIC_SUPABASE_URL = https://YOUR_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY = YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY = YOUR_SERVICE_KEY
```

⚠️ **IMPORTANTE**: A chave `SUPABASE_SERVICE_ROLE_KEY` **NÃO** deve ser público — marque como **Secret**.

3. Clique em **Deploy**

---

## 4. Testar a aplicação

1. Acesse a URL gerada pela Vercel (ex: `https://viahub-conducao.vercel.app`)
2. Faça login com o usuário de teste criado no Supabase
3. Você deve ver a lista de motoristas
4. Clique em um motorista para ver os detalhes

---

## 5. Próximos passos

### Pendente de confirmação (veja CLAUDE.md, seção 6):

- [ ] Endpoint e autenticação reais da Maxtrack
- [ ] Unidade dos campos de consumo de combustível
- [ ] Estrutura final do Master Drive (empresa inteira vs. por unidade)
- [ ] Prazo de retenção de telemetria (LGPD)
- [ ] Nomes de exibição das unidades operacionais

### Funcionalidades ainda não implementadas:

- [ ] Painel Admin de configuração de indicadores
- [ ] Interface completa do Master Drive (atendimentos, correções)
- [ ] Integração real da Maxtrack (está em modo mock)
- [ ] Seeding automático de dados de exemplo
- [ ] Grafos e evolução histórica de motoristas
- [ ] Exportação de relatórios

---

## Troubleshooting

### Erro 401 ao fazer login
- Verifique se o usuário foi criado em **Supabase Auth**
- Verifique se a senha está correta
- Verifique se o usuário foi vinculado na tabela `usuarios`

### Erro ao listar motoristas
- Certifique-se de que as políticas de Row Level Security (RLS) foram criadas
- Verifique se o usuário tem papel configurado (`papel IN ('gestor', 'master_drive', ...)`)
- Verifique se a empresa_id está correta

### Build falha na Vercel
- Verifique se todas as variáveis de ambiente estão configuradas
- Verifique os logs de build: **Deployments** → **Click on deployment** → **Build Logs**

---

## Documentação referencial

- [CLAUDE.md](./CLAUDE.md) — Especificação técnica completa
- [schema.sql](./schema.sql) — Schema do banco de dados
- [fixtures/dados-reais-exemplo.json](./fixtures/dados-reais-exemplo.json) — Dados de exemplo reais
- [reference/tela-individual-motorista.html](../reference/tela-individual-motorista.html) — Protótipo de referência
