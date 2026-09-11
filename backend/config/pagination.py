from rest_framework.pagination import PageNumberPagination


class PaginacionEstandar(PageNumberPagination):
    """Igual que la paginacion por default (50 por pagina), pero admite
    ?page_size=N para pedir mas de un jalon -- api.getAll() del frontend
    (frontend/src/api/client.js) lo usa para no tener que hacer varias
    peticiones seguidas cuando ya sabe que quiere la coleccion completa
    (ej. las unidades de una entidad en JornadaDetallePage, que facil pasan
    de las 50 filas). Tope de 1000 para que nadie pida de un jalon un
    catalogo completo de miles de filas (ej. unidades-medicas sin filtrar)."""

    page_size_query_param = "page_size"
    max_page_size = 1000
