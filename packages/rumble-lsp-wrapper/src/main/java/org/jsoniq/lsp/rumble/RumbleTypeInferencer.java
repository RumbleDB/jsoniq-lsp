package org.jsoniq.lsp.rumble;

import org.rumbledb.compiler.VisitorHelpers;
import org.rumbledb.config.RumbleRuntimeConfiguration;
import org.rumbledb.context.Name;
import org.rumbledb.context.StaticContext;
import org.rumbledb.exceptions.ExceptionMetadata;
import org.rumbledb.expressions.Node;
import org.rumbledb.expressions.flowr.Clause;
import org.rumbledb.expressions.flowr.CountClause;
import org.rumbledb.expressions.flowr.ForClause;
import org.rumbledb.expressions.flowr.GroupByClause;
import org.rumbledb.expressions.flowr.GroupByVariableDeclaration;
import org.rumbledb.expressions.flowr.LetClause;
import org.rumbledb.expressions.module.FunctionDeclaration;
import org.rumbledb.expressions.module.MainModule;
import org.rumbledb.expressions.primary.InlineFunctionExpression;
import org.rumbledb.types.SequenceType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class RumbleTypeInferencer {
    private static final Comparator<VariableType> VARIABLE_TYPE_POSITION_COMPARATOR = Comparator
            .comparingInt(VariableType::line)
            .thenComparingInt(VariableType::column);

    private static final Comparator<FunctionType> FUNCTION_TYPE_POSITION_COMPARATOR = Comparator
            .comparingInt(FunctionType::line)
            .thenComparingInt(FunctionType::column);

    /**
     * Represents the type of a variable.
     * 
     * @param line     the line number of the variable declaration
     * @param column   the column number of the variable declaration
     * @param name     the name of the variable
     * @param type     the inferred type of the variable
     * @param nodeKind the kind of AST node that declares the variable (e.g.,
     *                 "ForVariableDeclaration", "LetVariableDeclaration", etc.)
     */
    public record VariableType(
            int line,
            int column,
            String name,
            String type,
            String nodeKind) {
    }

    /**
     * Represents the type of a function.
     * 
     * @param line           the line number of the function declaration
     * @param column         the column number of the function declaration
     * @param name           the name of the function
     * @param parameterTypes a map of parameter names to their types
     * @param returnType     the return type of the function
     */
    public record FunctionType(
            int line,
            int column,
            String name,
            Map<String, String> parameterTypes,
            String returnType) {
    }

    public record InferenceResult(List<VariableType> variableTypes, List<FunctionType> functionTypes, String error) {
    }

    private final RumbleRuntimeConfiguration configuration;

    public RumbleTypeInferencer() {
        this(new String[] {});
    }

    public RumbleTypeInferencer(String[] args) {
        this.configuration = new RumbleRuntimeConfiguration(args);
    }

    public InferenceResult infer(String query) {
        if (query == null || query.isEmpty()) {
            return new InferenceResult(List.of(), List.of(), null);
        }

        try {
            MainModule module = VisitorHelpers.parseMainModuleFromQuery(query, this.configuration);
            List<VariableType> variableTypes = new ArrayList<>();
            List<FunctionType> functionTypes = new ArrayList<>();

            visitNodeAndCollectTypes(module, variableTypes, functionTypes);

            variableTypes.sort(VARIABLE_TYPE_POSITION_COMPARATOR);
            functionTypes.sort(FUNCTION_TYPE_POSITION_COMPARATOR);

            return new InferenceResult(variableTypes, functionTypes, null);
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            return new InferenceResult(List.of(), List.of(), errorMessage);
        }
    }

    /**
     * Recursively visits the AST nodes and collects variable and function types.
     * 
     * @param node          the current AST node being visited
     * @param variableTypes the list to collect variable types into
     * @param functionTypes the list to collect function types into
     */
    private static void visitNodeAndCollectTypes(
            Node node,
            List<VariableType> variableTypes,
            List<FunctionType> functionTypes) {
        if (node == null) {
            return;
        }

        collectFunctionType(node, functionTypes);
        collectVariableType(node, variableTypes);

        for (Node child : node.getChildren()) {
            visitNodeAndCollectTypes(child, variableTypes, functionTypes);
        }
    }

    /**
     * Collects function type from the given AST node if it declares a function
     * 
     * @param node          the AST node to check for function declarations
     * @param functionTypes the list to collect function types into
     */
    private static void collectFunctionType(
            Node node,
            List<FunctionType> functionTypes) {
        if (!(node instanceof FunctionDeclaration functionDeclaration)) {
            return;
        }

        if (!(functionDeclaration.getExpression() instanceof InlineFunctionExpression functionExpression)) {
            return;
        }

        ExceptionMetadata metadata = functionDeclaration.getMetadata();
        if (metadata == null) {
            return;
        }

        int line = metadata.getTokenLineNumber();
        int column = metadata.getTokenColumnNumber();

        Map<String, String> parameterTypes = new LinkedHashMap<>();
        functionExpression.getParams().forEach((name, type) -> {
            String parameterName = name.getLocalName() == null ? name.toString() : name.getLocalName();
            String parameterType = type == null ? "item*" : type.toString();
            parameterTypes.put("$" + parameterName, parameterType);
        });

        SequenceType returnType = functionExpression.getReturnType();
        if (returnType == null) {
            returnType = SequenceType.createSequenceType("item*");
        }

        functionTypes.add(new FunctionType(
                line,
                column,
                functionDeclaration.getFunctionIdentifier().toString(),
                parameterTypes,
                returnType.toString()));
    }

    /**
     * Collects variable types from the given AST node if it declares variables
     * 
     * @param node          the AST node to check for variable declarations
     * @param variableTypes the list to collect variable types into
     */
    private static void collectVariableType(
            Node node,
            List<VariableType> variableTypes) {
        if (!(node instanceof Clause clause)) {
            return;
        }

        /// Note: we are moving to the next clause's static context because that's where
        /// the current clause's variables are in scope.
        // If we stay in the current clause's static context, we won't find the
        /// variables because they haven't been added to the static context yet.
        StaticContext typeContext = clause.getNextClause() != null
                ? clause.getNextClause().getStaticContext()
                : clause.getStaticContext();

        if (typeContext == null) {
            return;
        }

        if (clause instanceof ForClause forClause) {
            addVariableTypeFromContext(
                    typeContext,
                    forClause.getVariableName(),
                    "ForVariableDeclaration",
                    variableTypes);

            // Positional variable is optional, so we check if it exists before trying to
            // add its type
            Name positionalVariableName = forClause.getPositionalVariableName();
            if (positionalVariableName != null) {
                addVariableTypeFromContext(
                        typeContext,
                        positionalVariableName,
                        "ForPositionalVariableDeclaration",
                        variableTypes);
            }
            return;
        }

        if (clause instanceof LetClause letClause) {
            addVariableTypeFromContext(
                    typeContext,
                    letClause.getVariableName(),
                    "LetVariableDeclaration",
                    variableTypes);
            return;
        }

        if (clause instanceof CountClause countClause) {
            addVariableTypeFromContext(
                    typeContext,
                    countClause.getCountVariableName(),
                    "CountVariableDeclaration",
                    variableTypes);
            return;
        }

        if (clause instanceof GroupByClause groupByClause) {
            for (GroupByVariableDeclaration groupByVariable : groupByClause.getGroupVariables()) {
                addVariableTypeFromContext(
                        typeContext,
                        groupByVariable.getVariableName(),
                        "GroupByVariableDeclaration",
                        variableTypes);
            }
        }
    }

    /**
     * Adds a variable type to the list of variable types based on the static
     * context and variable name.
     * 
     * @param context       the static context to retrieve the variable type from
     * @param variableName  the name of the variable to retrieve the type for
     * @param nodeKind      the kind of AST node that declares the variable (e.g.,
     *                      "ForVariableDeclaration")
     * @param variableTypes the list to add the variable type to
     * @return true if the variable type was successfully added, false otherwise
     */
    private static boolean addVariableTypeFromContext(
            StaticContext context,
            Name variableName,
            String nodeKind,
            List<VariableType> variableTypes) {
        if (context == null || variableName == null) {
            return false;
        }

        try {
            SequenceType variableType = context.getVariableSequenceType(variableName);
            ExceptionMetadata metadata = context.getVariableMetadata(variableName);
            int line = metadata.getTokenLineNumber();
            int column = metadata.getTokenColumnNumber();

            variableTypes
                    .add(new VariableType(line, column, variableName.toString(), variableType.toString(), nodeKind));
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
