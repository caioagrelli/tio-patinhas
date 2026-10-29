"""
Middleware que mantém os lançamentos em dia a cada requisição:
gera os fixos do mês e leva para o saldo os previstos cuja data chegou.
"""

from .services import processar_lancamentos


class ProcessarLancamentosMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            processar_lancamentos(request.user)
        return self.get_response(request)
