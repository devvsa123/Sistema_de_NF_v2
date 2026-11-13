"""Gera o modelo padrão do TAV (.odt) do zero. Uso: python3 scripts/gerar-modelo-tav.py public/brasao.png modelos/tav.odt"""
import sys, zipfile

BRASAO = sys.argv[1]
SAIDA = sys.argv[2]

PERGUNTAS = [
    "Volumes entregues em conformidade com a nota fiscal?",
    "Itens entregues conferem com a quantidade de itens da nota fiscal?",
    "Itens por volume entregues conferem com a quantidade padrão?",
    "Volumes identificados com código de barras afixados externamente?",
    "Embalagens de acordo com o Manual de Embalagens da Marinha?",
    "Etiquetas das embalagens estão em conformidade com a norma de embalagem?",
    "Item acompanha laudo laboratorial?",
]

NS = (
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" '
    'xmlns:dc="http://purl.org/dc/elements/1.1/" '
    'office:version="1.3"'
)

AZUL = "#1f3864"
CINZA = "#595959"
BORDA = "0.5pt solid #8c8c8c"
FUNDO = "#e8edf4"


def txt(size, bold=False, color=None, italic=False, caps=False):
    a = f'fo:font-size="{size}pt" style:font-size-asian="{size}pt" style:font-size-complex="{size}pt"'
    if bold:
        a += ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"'
    if italic:
        a += ' fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"'
    if color:
        a += f' fo:color="{color}"'
    if caps:
        a += ' fo:letter-spacing="0.02cm"'
    return f'<style:text-properties {a}/>'


def base_margens(extra):
    return " ".join(f'fo:{k}="0cm"' for k in ("margin-top", "margin-bottom") if f"fo:{k}=" not in extra)


def par(nome, size, align="start", bold=False, color=None, italic=False, extra="", caps=False):
    return (
        f'<style:style style:name="{nome}" style:family="paragraph" style:parent-style-name="Standard">'
        f'<style:paragraph-properties fo:text-align="{align}" {base_margens(extra)} {extra}/>'
        f'{txt(size, bold, color, italic, caps)}</style:style>'
    )


STYLES = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles {NS}>
<office:font-face-decls>
<style:font-face style:name="Arial" svg:font-family="Arial" style:font-family-generic="swiss" style:font-pitch="variable"/>
</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph">
<style:paragraph-properties fo:orphans="2" fo:widows="2"/>
<style:text-properties style:font-name="Arial" fo:font-size="9pt" fo:language="pt" fo:country="BR" style:font-name-asian="Arial" style:font-name-complex="Arial"/>
</style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text">
<style:text-properties style:font-name="Arial" fo:font-size="9pt"/>
</style:style>
{par("Rotulo", 6.5, bold=True, color=CINZA, caps=True)}
{par("Valor", 10, extra='fo:margin-top="0.03cm"')}
{par("ValorB", 10, bold=True, extra='fo:margin-top="0.03cm"')}
{par("Corpo", 8.5)}
{par("Centro", 8.5, align="center")}
{par("Marca", 10, align="center", bold=True, color=AZUL)}
{par("Cab", 7, align="center", bold=True, color=AZUL, caps=True)}
{par("CabE", 7, bold=True, color=AZUL, caps=True)}
{par("Nota", 7.5, italic=True, color=CINZA, extra='fo:margin-top="0.1cm"')}
{par("Org1", 10.5, align="center", bold=True)}
{par("Org2", 9, align="center", bold=True, extra='fo:margin-top="0.05cm"')}
{par("Titulo", 15, align="center", bold=True, color=AZUL, extra='fo:margin-top="0.35cm"')}
{par("Numero", 12, align="center", bold=True, extra='fo:margin-top="0.05cm" fo:margin-bottom="0.15cm"')}
<style:style style:name="Secao" style:family="paragraph" style:parent-style-name="Standard">
<style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.15cm" fo:padding-bottom="0.05cm" fo:border-bottom="1.1pt solid {AZUL}" fo:border-top="none" fo:border-left="none" fo:border-right="none" fo:keep-with-next="always"/>
{txt(9.5, True, AZUL, caps=True)}
</style:style>
{par("AssLinha", 8, align="center", extra=f'fo:margin-top="1.5cm" fo:padding-top="0.08cm" fo:border-top="0.75pt solid #000000" fo:border-bottom="none" fo:border-left="none" fo:border-right="none" fo:margin-left="0.3cm" fo:margin-right="0.3cm"')}
{par("AssNome", 8.5, align="center", bold=True)}
{par("AssCargo", 7, align="center", color=CINZA, caps=True, extra='fo:margin-top="0.04cm"')}
{par("Rodape", 7, align="center", color=CINZA)}
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1">
<style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="1.3cm" fo:margin-bottom="1.0cm" fo:margin-left="1.5cm" fo:margin-right="1.5cm"/>
<style:footer-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-top="0.3cm"/></style:footer-style>
</style:page-layout>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="pm1">
<style:footer><text:p text:style-name="Rodape">TAV nº {{{{numero_tav}}}}/{{{{ano}}}} · NF {{{{numero_nf}}}} · Página <text:page-number text:select-page="current">1</text:page-number> de <text:page-count>1</text:page-count></text:p></style:footer>
</style:master-page>
</office:master-styles>
</office:document-styles>
"""


def cel(estilo, conteudo, span=1):
    s = f' table:number-columns-spanned="{span}"' if span > 1 else ""
    cov = "<table:covered-table-cell/>" * (span - 1)
    return f'<table:table-cell table:style-name="{estilo}" office:value-type="string"{s}>{conteudo}</table:table-cell>{cov}'


def p(estilo, t=""):
    return f'<text:p text:style-name="{estilo}">{t}</text:p>' if t else f'<text:p text:style-name="{estilo}"/>'


def campo(rotulo, valor, estilo="Valor"):
    return p("Rotulo", rotulo) + p(estilo, valor)


def tabela(nome, larguras, linhas):
    cols = "".join(f'<table:table-column table:style-name="{nome}.C{i}"/>' for i in range(len(larguras)))
    return f'<table:table table:name="{nome}" table:style-name="{nome}">{cols}{"".join(linhas)}</table:table>'


def estilos_tabela(nome, larguras):
    total = sum(larguras)
    s = f'<style:style style:name="{nome}" style:family="table"><style:table-properties style:width="{total}cm" table:align="left" fo:margin-left="0cm"/></style:style>'
    for i, w in enumerate(larguras):
        s += f'<style:style style:name="{nome}.C{i}" style:family="table-column"><style:table-column-properties style:column-width="{w}cm"/></style:style>'
    return s


def row(c, estilo_linha=None):
    a = f' table:style-name="{estilo_linha}"' if estilo_linha else ""
    return f"<table:table-row{a}>{c}</table:table-row>"


W = 18.0
T_ID = [7.0, 3.6, 3.4, 4.0]
T_CONF = [1.0, 13.0, 2.0, 2.0]
T_FORMA = [1.0, 8.0, 1.0, 8.0]
T_OBS = [W]
T_ASS = [6.0, 6.0, 6.0]

auto = (
    estilos_tabela("TId", T_ID) + estilos_tabela("TConf", T_CONF) + estilos_tabela("TForma", T_FORMA)
    + estilos_tabela("TObs", T_OBS) + estilos_tabela("TAss", T_ASS) + estilos_tabela("TCab", [3.0, 12.0, 3.0])
    + f'<style:style style:name="CB" style:family="table-cell"><style:table-cell-properties fo:padding-left="0.15cm" fo:padding-right="0.15cm" fo:padding-top="0.08cm" fo:padding-bottom="0.08cm" fo:border="{BORDA}" style:vertical-align="middle"/></style:style>'
    + f'<style:style style:name="CH" style:family="table-cell"><style:table-cell-properties fo:padding="0.08cm" fo:background-color="{FUNDO}" fo:border="{BORDA}" style:vertical-align="middle"/></style:style>'
    + f'<style:style style:name="CX" style:family="table-cell"><style:table-cell-properties fo:padding="0.06cm" fo:border="{BORDA}" style:vertical-align="middle"/></style:style>'
    + '<style:style style:name="CN" style:family="table-cell"><style:table-cell-properties fo:padding="0cm" fo:border="none" style:vertical-align="middle"/></style:style>'
    + '<style:style style:name="CObs" style:family="table-cell"><style:table-cell-properties fo:padding="0.15cm" fo:border="0.5pt solid #8c8c8c" style:vertical-align="top"/></style:style>'
    + '<style:style style:name="RObs" style:family="table-row"><style:table-row-properties style:min-row-height="2.2cm"/></style:style>'
    + '<style:style style:name="RAss" style:family="table-row"><style:table-row-properties fo:keep-together="always"/></style:style>'
    + '<style:style style:name="TAssKeep" style:family="table"><style:table-properties style:width="18cm" table:align="left" fo:keep-with-next="always" style:may-break-between-rows="false"/></style:style>'
    + '<style:style style:name="fr1" style:family="graphic"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph" style:wrap="none"/></style:style>'
    + '<style:style style:name="PImg" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.1cm"/></style:style>'
)

# Cabeçalho
brasao = (
    '<text:p text:style-name="PImg"><draw:frame draw:style-name="fr1" draw:name="Brasao" text:anchor-type="as-char" '
    'svg:width="1.35cm" svg:height="1.75cm" draw:z-index="0"><draw:image xlink:href="Pictures/brasao.png" xlink:type="simple" '
    'xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>'
)
cabecalho = (
    brasao
    + p("Org1", "MARINHA DO BRASIL")
    + p("Org2", "DEPÓSITO DE FARDAMENTO DA MARINHA NO RIO DE JANEIRO")
    + p("Titulo", "TERMO DE ABERTURA DE VOLUMES")
    + p("Numero", "Nº {{numero_tav}}/{{ano}}")
)

# Identificação
ident = p("Secao", "Identificação") + tabela("TId", T_ID, [
    row(cel("CB", campo("Fornecedor", "{{nome_empresa}}", "ValorB"), 3) + cel("CB", campo("CNPJ", "{{cnpj}}"))),
    row(cel("CB", campo("Nota fiscal", "{{numero_nf}}", "ValorB")) + cel("CB", campo("Ordem de compra", "{{numero_oc}}"))
        + cel("CB", campo("ID do PA", "{{id_pa}}")) + cel("CB", campo("Data do recebimento", "{{data_recebimento}}"))),
    row(cel("CB", campo("Lote", "{{lote}}")) + cel("CB", campo("Fabricação", "{{fabricacao}}"))
        + cel("CB", campo("Volumes", "{{volumes}}"), 2)),
])

# Conferência
forma = tabela("TForma", T_FORMA, [
    row(cel("CX", p("Marca", "{{x_contagem}}")) + cel("CN", p("Corpo", '<text:s text:c="2"/>Contagem manual'))
        + cel("CX", p("Marca", "{{x_pesagem}}")) + cel("CN", p("Corpo", '<text:s text:c="2"/>Pesagem'))),
])
linhas_q = [row(cel("CH", p("Cab", "Nº")) + cel("CH", p("CabE", "Verificação")) + cel("CH", p("Cab", "Sim")) + cel("CH", p("Cab", "Não")))]
for i, q in enumerate(PERGUNTAS, 1):
    linhas_q.append(row(cel("CX", p("Centro", str(i))) + cel("CB", p("Corpo", q))
                        + cel("CX", p("Marca", f"{{{{q{i}_sim}}}}")) + cel("CX", p("Marca", f"{{{{q{i}_nao}}}}"))))
conf = (
    p("Secao", "Conferência")
    + p("Rotulo", "Forma de conferência") + '<text:p text:style-name="Valor"/>' + forma
    + '<text:p text:style-name="Valor"/>' + tabela("TConf", T_CONF, linhas_q)
    + p("Nota", "* Caso confirmada discrepância em algum item acima, relatar no campo Observações.")
)

obs = p("Secao", "Observações") + tabela("TObs", T_OBS, [row(cel("CObs", p("Corpo", "{{observacao}}")), "RObs")])

itens = p("Standard", "{{tabela_itens}}")


def ass(nome, cargo):
    return p("AssLinha", "") + (p("AssNome", nome) if nome else p("AssNome", "")) + p("AssCargo", cargo)


assin = (
    p("Secao", "Assinaturas")
    + f'<table:table table:name="TAss" table:style-name="TAssKeep">'
    + "".join(f'<table:table-column table:style-name="TAss.C{i}"/>' for i in range(3))
    + row(cel("CN", ass("", "Encarregado da Seção de Estocagem")) + cel("CN", ass("", "Encarregado da Seção de Recebimento"))
          + cel("CN", ass("{{responsavel}}", "Responsável pelo pré-recebimento")), "RAss")
    + "</table:table>"
)

CONTENT = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-content {NS}>
<office:font-face-decls><style:font-face style:name="Arial" svg:font-family="Arial" style:font-family-generic="swiss" style:font-pitch="variable"/></office:font-face-decls>
<office:automatic-styles>{auto}</office:automatic-styles>
<office:body><office:text>{cabecalho}{ident}{conf}{obs}{itens}{assin}</office:text></office:body>
</office:document-content>
"""

MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Pictures/brasao.png" manifest:media-type="image/png"/>
</manifest:manifest>
"""

META = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta {NS}><office:meta><dc:title>Termo de Abertura de Volumes</dc:title></office:meta></office:document-meta>
"""

with zipfile.ZipFile(SAIDA, "w") as z:
    z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
    for nome, conteudo in [("content.xml", CONTENT), ("styles.xml", STYLES), ("meta.xml", META), ("META-INF/manifest.xml", MANIFEST)]:
        z.writestr(nome, conteudo, compress_type=zipfile.ZIP_DEFLATED)
    z.write(BRASAO, "Pictures/brasao.png", compress_type=zipfile.ZIP_STORED)
print("ok", SAIDA)
