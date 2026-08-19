"""impl:CharacterGeneratorPort 的装配实现(串联 strategy + 最后一公里)。"""

from .character_generator import CharacterGenerator
from .character_namer import LangChainCharacterNamer

__all__ = ["CharacterGenerator", "LangChainCharacterNamer"]
