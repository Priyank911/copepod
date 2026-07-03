"""
Code structure extractor using Python's AST module.

Extracts functions, classes, imports, and call graphs from Python source
and converts them into structured sentences for Cognee ingestion.
"""

from __future__ import annotations

import ast
import logging
from dataclasses import dataclass, field
from typing import Optional

from app.services.formatter import format_function, format_class

logger = logging.getLogger(__name__)


@dataclass
class ExtractedFunction:
    name: str
    lineno: int
    end_lineno: int
    args: list[str]
    decorators: list[str]
    calls: list[str] = field(default_factory=list)
    is_async: bool = False
    docstring: Optional[str] = None


@dataclass
class ExtractedClass:
    name: str
    lineno: int
    end_lineno: int
    bases: list[str]
    methods: list[str]
    docstring: Optional[str] = None


class PythonCodeAnalyzer(ast.NodeVisitor):
    """Walk an AST and extract functions, classes, and call relationships."""

    def __init__(self) -> None:
        self.functions: list[ExtractedFunction] = []
        self.classes: list[ExtractedClass] = []
        self._current_function: Optional[str] = None
        self._current_class: Optional[str] = None
        self._call_graph: dict[str, set[str]] = {}

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._process_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._process_function(node, is_async=True)

    def _process_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef, is_async: bool) -> None:
        decorators = []
        for d in node.decorator_list:
            try:
                decorators.append(ast.unparse(d))
            except Exception:
                pass

        args = [arg.arg for arg in node.args.args if arg.arg != "self"]
        docstring = ast.get_docstring(node)

        func = ExtractedFunction(
            name=node.name,
            lineno=node.lineno,
            end_lineno=node.end_lineno or node.lineno,
            args=args,
            decorators=decorators,
            is_async=is_async,
            docstring=docstring,
        )

        prev_func = self._current_function
        qualified = f"{self._current_class}.{node.name}" if self._current_class else node.name
        self._current_function = qualified
        self._call_graph.setdefault(qualified, set())

        if self._current_class:
            # Will add method name to class later
            pass
        else:
            self.functions.append(func)

        self.generic_visit(node)
        self._current_function = prev_func

        # Attach discovered calls
        func.calls = sorted(self._call_graph.get(qualified, set()))

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        bases = []
        for b in node.bases:
            try:
                bases.append(ast.unparse(b))
            except Exception:
                pass

        docstring = ast.get_docstring(node)
        methods: list[str] = []
        for item in node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                methods.append(item.name)

        cls = ExtractedClass(
            name=node.name,
            lineno=node.lineno,
            end_lineno=node.end_lineno or node.lineno,
            bases=bases,
            methods=methods,
            docstring=docstring,
        )
        self.classes.append(cls)

        prev_class = self._current_class
        self._current_class = node.name
        self.generic_visit(node)
        self._current_class = prev_class

    def visit_Call(self, node: ast.Call) -> None:
        if self._current_function:
            callee = self._resolve_call(node.func)
            if callee:
                self._call_graph.setdefault(self._current_function, set()).add(callee)
        self.generic_visit(node)

    @staticmethod
    def _resolve_call(node: ast.expr) -> Optional[str]:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        return None


def parse_python_file(file_path: str, source: str) -> list[str]:
    """
    Parse a Python file and return structured sentences for Cognee.

    Returns a list of formatted sentences describing functions and classes.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        logger.warning("Syntax error in %s, skipping", file_path)
        return []

    analyzer = PythonCodeAnalyzer()
    analyzer.visit(tree)

    sentences: list[str] = []

    for func in analyzer.functions:
        sentences.append(
            format_function(
                name=func.name,
                file_path=file_path,
                lineno=func.lineno,
                docstring=func.docstring,
                calls=func.calls,
                is_async=func.is_async,
            )
        )

    for cls in analyzer.classes:
        sentences.append(
            format_class(
                name=cls.name,
                file_path=file_path,
                methods=cls.methods,
                bases=cls.bases,
                docstring=cls.docstring,
            )
        )

    return sentences


def parse_source_file(file_path: str, source: str) -> list[str]:
    """
    Parse any supported source file and return structured sentences.
    Currently supports Python. JS/TS/Go via tree-sitter can be added later.
    """
    if file_path.endswith(".py"):
        return parse_python_file(file_path, source)

    # Placeholder for tree-sitter languages (JS, TS, Go)
    # Can be added with: pip install tree-sitter tree-sitter-languages
    return []
